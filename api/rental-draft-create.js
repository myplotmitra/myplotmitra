'use strict';

const { admin, authenticate } = require('./_r2');
const {
  normalizePropertyCreateRequest,
  validateReadyPhotoUploads
} = require('./_property-create-policy');
const { calculateRentalDraftPricing } = require('./_rental-pricing');

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validEmail(value) {
  return typeof value === 'string' &&
    value.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const user = await authenticate(req);

    if (!user || !user.uid) {
      fail(401, 'Authentication required');
    }

    if (!validEmail(String(user.email || '').trim())) {
      fail(400, 'A valid account email is required');
    }

    const normalized = normalizePropertyCreateRequest(req.body || {});

    if (normalized.publicData.transactionType !== 'rent') {
      fail(400, 'This endpoint accepts rental listings only');
    }

    const db = admin.firestore();
    const settingsRef = db.collection('settings').doc('app');
    const draftRef = db.collection('rentalDrafts').doc();
    const propertyId = db.collection('properties').doc().id;

    const uploadRefs = normalized.photoKeys.map(key => {
      const parsed = require('./_property-upload-registry')
        .parseOpaquePropertyImageKey(key);

      if (!parsed) fail(400, 'Invalid rental image key');

      return db.collection('propertyUploads').doc(parsed.uploadId);
    });

    const now = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now + DRAFT_LIFETIME_MS
    );

    const ownerName = String(
      user.displayName || user.name || ''
    ).trim().slice(0, 120) || 'User';
    let checkoutPricing = null;

    await db.runTransaction(async tx => {
      // Read every document before performing any writes.
      const settingsSnap = await tx.get(settingsRef);

      const settings = settingsSnap.exists ? (settingsSnap.data() || {}) : {};
      const configuredRentalLimit = settings.rentalMaxPhotos;
      const rentalMaxPhotos = configuredRentalLimit == null ? 20 : configuredRentalLimit;
      if (!Number.isSafeInteger(rentalMaxPhotos) || rentalMaxPhotos < 1 || rentalMaxPhotos > 100) {
        fail(500, 'Invalid rental photo limit settings');
      }
      if (normalized.photoKeys.length > rentalMaxPhotos) {
        fail(400, 'Rental photo limit exceeded');
      }

      // Calculate the fee exclusively from trusted server settings.
      const photoCount = normalized.photoKeys.length;

      if (photoCount < 1) {
        fail(400, 'At least one rental photo is required');
      }

      const featuredRequested = normalized.publicData.featuredRequested === true;
      const socialPromotionPlatforms = Array.isArray(normalized.publicData.socialPromotionPlatforms)
        ? normalized.publicData.socialPromotionPlatforms.slice()
        : [];
      if (
        settings.rentalOnePhotoFreeEnabled !== false &&
        photoCount === 1 &&
        !featuredRequested &&
        socialPromotionPlatforms.length === 0
      ) {
        fail(409, 'This one-photo rental qualifies for the free listing path');
      }

      const checkout = calculateRentalDraftPricing({
        settings,
        photoCount,
        featuredRequested,
        socialPromotionPlatforms
      });
      const rentalFeeAmount = checkout.amount;
      const pricingSnapshot = checkout.pricingSnapshot;
      checkoutPricing = { amount: rentalFeeAmount, pricingSnapshot };

      const uploadSnaps = await Promise.all(
        uploadRefs.map(ref => tx.get(ref))
      );

      const uploadRecords = uploadSnaps.map(snap => {
        if (!snap.exists) {
          fail(409, 'One or more rental images are no longer available');
        }
        return snap.data() || {};
      });

      // Validates ownership, ready status, expiry, verified content type,
      // and actual file size against the authenticated seller.
      validateReadyPhotoUploads(
        normalized.photoKeys,
        uploadRecords,
        user.uid,
        now
      );

      tx.create(draftRef, {
        propertyId,
        ownerId: user.uid,
        ownerEmail: String(user.email).trim().toLowerCase(),
        ownerName,
        property: normalized.publicData,
        sellerPhone: normalized.sellerPhone,
        photoKeys: [...normalized.photoKeys],
        photoCount: normalized.photoKeys.length,
        rentalMaxPhotos,
        rentalFeeAmount,
        addons: { featured: featuredRequested, badgeKeys: [] },
        socialPromotionPlatforms,
        currency: 'INR',
        pricingSnapshot,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt
      });

      uploadRefs.forEach(ref => {
        tx.update(ref, {
          status: 'held',
          rentalDraftId: draftRef.id,
          heldAt: admin.firestore.FieldValue.serverTimestamp(),
          heldExpiresAt: expiresAt,
          expiresAt: admin.firestore.FieldValue.delete()
        });
      });
    });

    return res.status(201).json({
      success: true,
      draftId: draftRef.id,
      status: 'pending_payment',
      photoCount: normalized.photoKeys.length,
      amount: checkoutPricing ? checkoutPricing.amount : null,
      pricingSnapshot: checkoutPricing ? checkoutPricing.pricingSnapshot : null
    });

  } catch (error) {
    const knownBadRequest = [
      'INVALID_REQUEST',
      'INVALID_REQUEST_FIELD',
      'PROPERTY_DATA_REQUIRED',
      'INVALID_PROPERTY_FIELD',
      'INVALID_TRANSACTION_TYPE',
      'INVALID_RENT_PERIOD',
      'MISSING_RENT_CATEGORY',
      'INVALID_RENT_CATEGORY',
      'RENTAL_SPACE_LAYOUT_REQUIRED',
      'INVALID_RENTAL_SPACE_LAYOUT_FIELD',
      'INVALID_RENTAL_SPACE_LAYOUT_MEASUREMENTS',
      'RENTAL_SPACE_LAYOUT_NOT_APPLICABLE',
      'RENTAL_PLOT_LAYOUT_NOT_APPLICABLE',
      'INVALID_RENTAL_PHOTO_COUNT',
      'INVALID_RENTAL_SOCIAL_PROMOTIONS',
      'INVALID_PROPERTY_TYPE',
      'INVALID_PRICE',
      'MISSING_TITLE',
      'MISSING_ADDRESS',
      'INVALID_SELLER_PHONE',
      'INVALID_PHOTO_KEYS',
      'INVALID_PROPERTY_IMAGE_KEY',
      'DUPLICATE_PROPERTY_IMAGE_KEY'
    ];

    const uploadConflictCodes = [
      'PROPERTY_UPLOAD_RECORDS_MISMATCH',
      'PROPERTY_IMAGE_NOT_READY_OR_NOT_OWNED',
      'PROPERTY_IMAGE_TYPE_NOT_VERIFIED',
      'PROPERTY_IMAGE_SIZE_NOT_VERIFIED'
    ];

    const status = Number(error.status) ||
      (uploadConflictCodes.includes(error.code) ? 409 :
        (knownBadRequest.includes(error.code) ? 400 : 500));

    console.error('rental-draft-create:', error.message || 'Unknown error');

    return res.status(status).json({
      error: status === 500
        ? 'Could not create rental draft'
        : error.message
    });
  }
};
