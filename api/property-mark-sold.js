'use strict';

const { admin, authenticate } = require('./_r2');
const {
  normalizeMarkSoldRequest,
  resolveOwnerId,
  validateMarkSold,
} = require('./_property-mark-sold-policy');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      error: 'POST only',
    });
  }

  try {
    const actor = await authenticate(req);
    const { propertyId } = normalizeMarkSoldRequest(req.body || {});

    const db = admin.firestore();
    const propertyRef = db.collection('properties').doc(propertyId);
    const privateRef = db.collection('propertyPrivate').doc(propertyId);

    const result = await db.runTransaction(async tx => {
      const [propertySnapshot, privateSnapshot] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef),
      ]);

      if (!propertySnapshot.exists) {
        const error = new Error('Property not found');
        error.status = 404;
        throw error;
      }

      const property = propertySnapshot.data() || {};
      const privateData = privateSnapshot.exists
        ? privateSnapshot.data() || {}
        : null;

      // A present private record is authoritative, even if ownerId is missing.
      const ownerId = resolveOwnerId(
        property,
        privateData,
        privateSnapshot.exists
      );

      validateMarkSold({
        property,
        ownerId,
        actorUid: actor.uid,
      });

      const stamp = admin.firestore.FieldValue.serverTimestamp();
      const removeField = admin.firestore.FieldValue.delete();

      tx.update(propertyRef, {
        status: 'sold',
        soldAt: stamp,
        soldBy: actor.uid,
        updatedAt: stamp,

        // Preserve the existing sold-listing expiry lifecycle.
        deletionState: 'pending',
        deletionAttempts: 0,
        deletionStartedAt: removeField,
        deletionLockToken: removeField,
        deletionError: removeField,
        deletionFailedAt: removeField,
      });

      return {
        success: true,
        propertyId,
        status: 'sold',
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(
        error.message || ''
      ) ? 401 : 500);

    if (status >= 500) {
      console.error('property-mark-sold:', error.message || error);
    }

    return res.status(status).json({
      success: false,
      error: status >= 500
        ? 'Could not mark property as sold. Please try again.'
        : status === 401
          ? 'Please sign in again'
          : error.message,
    });
  }
};
