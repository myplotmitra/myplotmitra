'use strict';

const crypto = require('crypto');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

const {
  admin,
  getClient,
  getBucket,
  authenticate
} = require('./_r2');

const {
  isValidPropertyImageKey
} = require('./_r2-property-keys');

const {
  parseOpaquePropertyImageKey,
  isCleanupEligiblePropertyUpload
} = require('./_property-upload-registry');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function isReferenced(db, key) {
  const [
    publicPhoto,
    publicCover,
    privatePhoto,
    privateCover
  ] = await Promise.all([
    db.collection('properties')
      .where('photoKeys', 'array-contains', key)
      .limit(1)
      .get(),

    db.collection('properties')
      .where('coverPhotoKey', '==', key)
      .limit(1)
      .get(),

    db.collection('propertyPrivate')
      .where('photoKeys', 'array-contains', key)
      .limit(1)
      .get(),

    db.collection('propertyPrivate')
      .where('coverPhotoKey', '==', key)
      .limit(1)
      .get()
  ]);

  return (
    !publicPhoto.empty ||
    !publicCover.empty ||
    !privatePhoto.empty ||
    !privateCover.empty
  );
}

async function claimOpaqueUploadForCleanup(db, ref, user, key) {
  const token = crypto.randomUUID();

  const previousStatus = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);

    if (!snapshot.exists) {
      fail(409, 'Property upload reservation no longer exists');
    }

    const upload = snapshot.data() || {};

    if (upload.ownerId !== user.uid || upload.key !== key) {
      fail(403, 'Property upload does not belong to this account');
    }

    if (!isCleanupEligiblePropertyUpload(upload, user.uid, key)) {
      fail(409, 'Property image is already attached or unavailable');
    }

    tx.update(ref, {
      status: 'deleting',
      cleanupToken: token,
      cleanupStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return upload.status;
  });

  return { token, previousStatus };
}

async function restoreOpaqueUploadAfterFailure(
  db,
  ref,
  token,
  previousStatus
) {
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;

    const upload = snapshot.data() || {};
    if (upload.status !== 'deleting' || upload.cleanupToken !== token) return;

    tx.update(ref, {
      status: previousStatus,
      cleanupToken: admin.firestore.FieldValue.delete(),
      cleanupStartedAt: admin.firestore.FieldValue.delete()
    });
  });
}

async function removeOpaqueUploadReservation(db, ref, token) {
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;

    const upload = snapshot.data() || {};

    if (upload.status === 'deleting' && upload.cleanupToken === token) {
      tx.delete(ref);
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const user = await authenticate(req);
    const keys = req.body?.keys;

    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) {
      return res.status(400).json({
        error: 'Provide between 1 and 100 property image keys'
      });
    }

    const uniqueKeys = [...new Set(keys)];

    if (uniqueKeys.some(key => typeof key !== 'string' || !key.trim())) {
      return res.status(400).json({ error: 'Invalid property image key' });
    }

    const db = admin.firestore();
    const client = getClient(false);
    const bucket = getBucket(false);

    const opaqueRefs = new Map();
    const initiallySkipped = new Set();

    // Validate every key before deleting any object.
    for (const key of uniqueKeys) {
      if (isValidPropertyImageKey(key, user.uid)) {
        continue; // Legacy UID-prefixed image.
      }

      const parsed = parseOpaquePropertyImageKey(key);

      if (!parsed) {
        fail(403, 'One or more image keys do not belong to this account');
      }

      const ref = db.collection('propertyUploads').doc(parsed.uploadId);
      const snapshot = await ref.get();

      if (!snapshot.exists) {
        fail(403, 'Property upload reservation was not found');
      }

      const upload = snapshot.data() || {};

      if (upload.ownerId !== user.uid || upload.key !== key) {
        fail(403, 'One or more image keys do not belong to this account');
      }

      if (upload.status === 'attached' || upload.propertyId) {
        initiallySkipped.add(key);
        continue;
      }

      if (!isCleanupEligiblePropertyUpload(upload, user.uid, key)) {
        initiallySkipped.add(key);
        continue;
      }

      opaqueRefs.set(key, ref);
    }

    const deleted = [];
    const skipped = [...initiallySkipped];

    for (const key of uniqueKeys) {
      if (initiallySkipped.has(key)) continue;

      // Preserve any object already referenced by a public or private property.
      if (await isReferenced(db, key)) {
        skipped.push(key);
        continue;
      }

      const uploadRef = opaqueRefs.get(key);
      let cleanupClaim = null;

      if (uploadRef) {
        try {
          // This state change races safely with property creation: creation
          // must read and attach the same registry document transactionally.
          cleanupClaim = await claimOpaqueUploadForCleanup(
            db,
            uploadRef,
            user,
            key
          );
        } catch (error) {
          if (error.status === 409) {
            skipped.push(key);
            continue;
          }
          throw error;
        }
      }

      try {
        await client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: key
        }));

        if (uploadRef && cleanupClaim) {
          await removeOpaqueUploadReservation(
            db,
            uploadRef,
            cleanupClaim.token
          );
        }

        deleted.push(key);

      } catch (error) {
        if (uploadRef && cleanupClaim) {
          try {
            await restoreOpaqueUploadAfterFailure(
              db,
              uploadRef,
              cleanupClaim.token,
              cleanupClaim.previousStatus
            );
          } catch (restoreError) {
            console.error(
              'Could not restore upload cleanup state:',
              restoreError.message
            );
          }
        }

        throw error;
      }
    }

    return res.status(200).json({ deleted, skipped });

  } catch (error) {
    console.error('R2 upload cleanup error:', error.message);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Could not clean up unused property images'
    });
  }
};
