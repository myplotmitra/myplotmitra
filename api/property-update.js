'use strict';

const { admin, authenticate } = require('./_r2');

const {
  normalizePropertyUpdateRequest,
  validateMergedProperty
} = require('./_property-update-policy');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);
    const { propertyId, patch } =
      normalizePropertyUpdateRequest(req.body || {});

    const db = admin.firestore();
    const propertyRef = db.collection('properties').doc(propertyId);
    const privateRef = db.collection('propertyPrivate').doc(propertyId);
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    const removeField = admin.firestore.FieldValue.delete();

    const result = await db.runTransaction(async tx => {
      const [propertySnap, privateSnap] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef)
      ]);

      if (!propertySnap.exists) {
        fail(404, 'Property not found');
      }

      const property = propertySnap.data() || {};
      const privateData = privateSnap.exists
        ? privateSnap.data() || {}
        : null;

      // A private record is authoritative, including when it is malformed.
      const ownerId = privateSnap.exists
        ? String(privateData.ownerId || '')
        : String(property.ownerId || '');

      if (!ownerId || ownerId !== actor.uid) {
        fail(403, 'You can only edit your own property');
      }

      if (
        property.status === 'sold' ||
        ['pending', 'deleting', 'error'].includes(
          String(property.deletionState || '')
        )
      ) {
        fail(409, 'This property cannot be edited in its current state');
      }

      if (!['pending', 'approved', 'rejected'].includes(
        String(property.status || '')
      )) {
        fail(409, 'This property cannot be edited in its current state');
      }

      validateMergedProperty(property, patch);

      // Any substantive edit to an approved/rejected listing returns it
      // to moderation. Payment, owner, badge, promo and photo data are kept.
      const requiresReview = ['approved', 'rejected'].includes(
        String(property.status || '')
      );

      const updates = {
        ...patch,
        updatedAt: stamp
      };

      if (requiresReview) {
        updates.status = 'pending';
        updates.reviewedBy = removeField;
        updates.reviewedAt = removeField;
        updates.rejectionReason = removeField;
      }

      tx.update(propertyRef, updates);

      return {
        success: true,
        propertyId,
        status: requiresReview ? 'pending' : property.status,
        reviewRequired: requiresReview
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(
        error.message || ''
      ) ? 401 : 500);

    if (status >= 500) {
      console.error('property-update:', error.message || error);
    }

    return res.status(status).json({
      success: false,
      error: status >= 500
        ? 'Could not update property. Please try again.'
        : status === 401
          ? 'Please sign in again'
          : error.message
    });
  }
};
