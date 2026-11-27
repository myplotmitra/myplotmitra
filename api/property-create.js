'use strict';

const { admin, authenticate } = require('./_r2');

const {
  normalizePropertyCreateRequest,
  validateReadyPhotoUploads,
  buildPropertyCreateDocuments
} = require('./_property-create-policy');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);

    if (!actor.email || typeof actor.email !== 'string') {
      fail(401, 'A valid signed-in email is required');
    }

    const normalized = normalizePropertyCreateRequest(req.body || {});
    const db = admin.firestore();

    const propertyRef = db.collection('properties').doc();
    const privateRef = db.collection('propertyPrivate').doc(propertyRef.id);
    const contactRef = db.collection('propertyContactInfo').doc(propertyRef.id);
    const settingsRef = db.collection('settings').doc('app');

    const uploadRefs = normalized.photoKeys.map(key => {
      const parsed = require('./_property-upload-registry')
        .parseOpaquePropertyImageKey(key);

      if (!parsed) fail(400, 'Invalid property image key');

      return {
        key,
        ref: db.collection('propertyUploads').doc(parsed.uploadId)
      };
    });

    const owner = {
      uid: actor.uid,
      email: actor.email,
      displayName: typeof actor.name === 'string' ? actor.name : 'User'
    };

    const documents = buildPropertyCreateDocuments({
      normalized,
      owner,
      publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || ''
    });

    const stamp = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async tx => {
      // Read settings and uploads before performing any transaction writes.
      const settingsSnap = await tx.get(settingsRef);
      const settings = settingsSnap.exists ? (settingsSnap.data() || {}) : {};
      const isRental = normalized.publicData.transactionType === 'rent';
      const configuredLimit = isRental ? settings.rentalMaxPhotos : settings.saleMaxPhotos;
      const maxPhotos = configuredLimit === undefined || configuredLimit === null ? 20 : configuredLimit;
      if (!Number.isSafeInteger(maxPhotos) || maxPhotos < 1 || maxPhotos > 100) {
        fail(500, 'INVALID_PHOTO_LIMIT_SETTINGS');
      }
      if (normalized.photoKeys.length > maxPhotos) fail(400, 'PHOTO_LIMIT_EXCEEDED');
        // Older settings documents default to allowing exactly one free rental photo.
        // Zero photos do not qualify for this exception.
        const onePhotoFreeEnabled = settings.rentalOnePhotoFreeEnabled !== false;
        const qualifiesForFreeRental =
          isRental &&
          onePhotoFreeEnabled &&
          normalized.photoKeys.length === 1;

        if (isRental && !qualifiesForFreeRental) {
          fail(
            409,
            settings.rentalPaymentEnabled === true
              ? 'RENTAL_PAYMENT_REQUIRED'
              : 'RENTAL_PHOTO_PAYMENT_DISABLED'
          );
        }
const uploadSnapshots = await Promise.all(
        uploadRefs.map(upload => tx.get(upload.ref))
      );

      const uploadRecords = uploadSnapshots.map(snapshot =>
        snapshot.exists ? snapshot.data() || {} : null
      );

      const attachments = validateReadyPhotoUploads(
        normalized.photoKeys,
        uploadRecords,
        actor.uid,
        Date.now()
      );

      tx.create(propertyRef, {
        ...documents.publicData,
        createdAt: stamp,
        updatedAt: stamp
      });

      tx.create(privateRef, documents.privateData);
      tx.create(contactRef, documents.contactInfo);

      for (const attachment of attachments) {
        const upload = uploadRefs.find(item => item.key === attachment.key);

        tx.update(upload.ref, {
          status: 'attached',
          propertyId: propertyRef.id,
          attachedAt: stamp,
          expiresAt: admin.firestore.FieldValue.delete()
        });
      }
    });

    return res.status(201).json({
      success: true,
      propertyId: propertyRef.id,
      photoCount: normalized.photoKeys.length
    });

  } catch (error) {
    const code = String(error.code || error.message || '');

    const status = Number(error.status) ||
      (/^(INVALID_|MISSING_|PROPERTY_|DUPLICATE_)/.test(code) ? 400 : 500);

    if (status >= 500) {
      console.error('property-create:', error.message || 'Unknown error');
    }

    return res.status(status).json({
      success: false,
      error: status < 500
        ? error.message
        : 'Could not submit property. Please try again.'
    });
  }
};
