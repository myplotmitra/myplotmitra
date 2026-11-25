'use strict';

const crypto = require('node:crypto');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

const {
  admin,
  getClient,
  getBucket,
  authenticate
} = require('./_r2');

const { isValidPropertyImageKey } = require('./_r2-property-keys');

const {
  parseOpaquePropertyImageKey,
  isAttachedPropertyUpload
} = require('./_property-upload-registry');

const {
  mergePropertyData,
  collectPropertyPhotoKeys
} = require('./_property-private');

const {
  normalizeDeleteRequest,
  resolveOwnerId,
  validatePropertyDelete
} = require('./_property-delete-policy');

const PREVIEW_BUCKET = 'myplotmitra-preview-properties';
const MAX_PROPERTY_PHOTOS = 50;

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sameStringArray(left, right) {
  if (left.length !== right.length) return false;

  const a = [...left].sort();
  const b = [...right].sort();

  return a.every((value, index) => value === b[index]);
}

async function recordDeletionFailure(db, propertyRef, privateRef, lockToken) {
  try {
    await db.runTransaction(async tx => {
      const [propertySnapshot, privateSnapshot] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef)
      ]);

      if (!propertySnapshot.exists) return;

      const property = propertySnapshot.data() || {};

      if (property.deletionLockToken !== lockToken) return;

      const ownerId = resolveOwnerId(
        property,
        privateSnapshot.exists ? privateSnapshot.data() : {},
        privateSnapshot.exists
      );

      if (!ownerId) return;

      tx.update(propertyRef, {
        deletionState: 'error',
        deletionError: 'R2_DELETE_FAILED',
        deletionFailedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletionStartedAt: admin.firestore.FieldValue.delete(),
        deletionLockToken: admin.firestore.FieldValue.delete()
      });
    });
  } catch (error) {
    console.error('Could not record property deletion failure:', error.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'POST only'
    });
  }

  const environment = String(process.env.VERCEL_ENV || '').toLowerCase();

  if (
    environment !== 'preview' ||
    process.env.R2_PROPERTY_BUCKET !== PREVIEW_BUCKET
  ) {
    return res.status(503).json({
      success: false,
      error: 'Property deletion is not enabled for this environment'
    });
  }

  let lockToken = null;
  let propertyRef = null;
  let privateRef = null;
  let db = null;

  try {
    const request = normalizeDeleteRequest(req.body);

    if (!request) {
      throw createError(400, 'Invalid property deletion request');
    }

    const user = await authenticate(req);

    db = admin.firestore();

    propertyRef = db.collection('properties').doc(request.propertyId);
    privateRef = db.collection('propertyPrivate').doc(request.propertyId);

    const contactInfoRef = db
      .collection('propertyContactInfo')
      .doc(request.propertyId);

    const bucket = getBucket(false);
    const client = getClient(false);

    lockToken = crypto.randomUUID();

    const prepared = await db.runTransaction(async tx => {
      const [propertySnapshot, privateSnapshot] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef)
      ]);

      if (!propertySnapshot.exists) {
        throw createError(404, 'Property not found');
      }

      const publicData = propertySnapshot.data() || {};
      const privateData = privateSnapshot.exists
        ? privateSnapshot.data() || {}
        : {};

      const ownerId = resolveOwnerId(
        publicData,
        privateData,
        privateSnapshot.exists
      );

      const property = mergePropertyData(
        publicData,
        privateSnapshot.exists ? privateData : {}
      );

      const validation = validatePropertyDelete({
        actorUid: user.uid,
        ownerId,
        property
      });

      if (!validation.ok) {
        throw createError(validation.status, validation.error);
      }

      let keys;

      try {
        keys = collectPropertyPhotoKeys(
          publicData,
          privateSnapshot.exists ? privateData : {}
        );
      } catch {
        throw createError(
          409,
          'Stored property photo information is invalid; property was not deleted'
        );
      }

      if (keys.length > MAX_PROPERTY_PHOTOS) {
        throw createError(
          409,
          'Property photo count exceeds the safe deletion limit'
        );
      }

      const opaqueById = new Map();

      for (const key of keys) {
        if (isValidPropertyImageKey(key, ownerId)) continue;

        const parsed = parseOpaquePropertyImageKey(key);

        if (!parsed) {
          throw createError(
            409,
            'A property photo key could not be verified; property was not deleted'
          );
        }

        const existing = opaqueById.get(parsed.uploadId);

        if (existing && existing.key !== key) {
          throw createError(
            409,
            'Conflicting property photo records were found'
          );
        }

        if (!existing) {
          opaqueById.set(parsed.uploadId, {
            key,
            ref: db.collection('propertyUploads').doc(parsed.uploadId)
          });
        }
      }

      const opaqueUploads = [...opaqueById.values()];

      const uploadSnapshots = await Promise.all(
        opaqueUploads.map(upload => tx.get(upload.ref))
      );

      for (let index = 0; index < opaqueUploads.length; index++) {
        const upload = opaqueUploads[index];
        const snapshot = uploadSnapshots[index];

        if (
          !snapshot.exists ||
          !isAttachedPropertyUpload(
            snapshot.data(),
            ownerId,
            request.propertyId,
            upload.key
          )
        ) {
          throw createError(
            409,
            'Property photo ownership could not be verified; property was not deleted'
          );
        }
      }

      tx.update(propertyRef, {
        deletionState: 'deleting',
        deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletionLockToken: lockToken,
        deletionError: admin.firestore.FieldValue.delete(),
        deletionFailedAt: admin.firestore.FieldValue.delete()
      });

      return {
        ownerId,
        keys,
        opaqueUploads
      };
    });

    for (const key of prepared.keys) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      }));
    }

    await db.runTransaction(async tx => {
      const uploadRefs = prepared.opaqueUploads.map(upload => upload.ref);

      const snapshots = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef),
        tx.get(contactInfoRef),
        ...uploadRefs.map(ref => tx.get(ref))
      ]);

      const [
        currentProperty,
        currentPrivate,
        currentContact,
        ...currentUploads
      ] = snapshots;

      if (!currentProperty.exists) {
        throw createError(409, 'Property changed during deletion; please retry');
      }

      const latestPublic = currentProperty.data() || {};
      const latestPrivate = currentPrivate.exists
        ? currentPrivate.data() || {}
        : {};

      if (
        latestPublic.deletionState !== 'deleting' ||
        latestPublic.deletionLockToken !== lockToken
      ) {
        throw createError(409, 'Property deletion lock changed; please retry');
      }

      const latestOwnerId = resolveOwnerId(
        latestPublic,
        latestPrivate,
        currentPrivate.exists
      );

      if (latestOwnerId !== prepared.ownerId || latestOwnerId !== user.uid) {
        throw createError(409, 'Property ownership changed; please retry');
      }

      let latestKeys;

      try {
        latestKeys = collectPropertyPhotoKeys(
          latestPublic,
          currentPrivate.exists ? latestPrivate : {}
        );
      } catch {
        throw createError(409, 'Property photo records changed; please retry');
      }

      if (!sameStringArray(latestKeys, prepared.keys)) {
        throw createError(409, 'Property photos changed during deletion; please retry');
      }

      for (let index = 0; index < prepared.opaqueUploads.length; index++) {
        const upload = prepared.opaqueUploads[index];
        const snapshot = currentUploads[index];

        if (
          !snapshot.exists ||
          !isAttachedPropertyUpload(
            snapshot.data(),
            prepared.ownerId,
            request.propertyId,
            upload.key
          )
        ) {
          throw createError(409, 'Property photo registry changed; please retry');
        }
      }

      tx.delete(propertyRef);

      if (currentPrivate.exists) tx.delete(privateRef);
      if (currentContact.exists) tx.delete(contactInfoRef);

      for (const upload of prepared.opaqueUploads) {
        tx.delete(upload.ref);
      }
    });

    return res.status(200).json({
      success: true,
      deletedPhotoCount: prepared.keys.length
    });
  } catch (error) {
    if (lockToken && db && propertyRef && privateRef) {
      await recordDeletionFailure(db, propertyRef, privateRef, lockToken);
    }

    const status = Number.isInteger(error.status) ? error.status : 500;

    if (status >= 500) {
      console.error('Preview property deletion failed:', error.message);
    }

    return res.status(status).json({
      success: false,
      error: status === 500
        ? 'Could not complete property deletion. Please retry or contact support.'
        : error.message
    });
  }
};
