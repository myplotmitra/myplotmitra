'use strict';

const { admin, authenticate, isAdmin } = require('./_r2');
const {
  normalizePublishedSocialUrl,
  isVerifiedSocialPromotionPayment
} = require('./_social-promotion-policy');
const { mergePropertyData } = require('./_property-private');

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
    if (!(await isAdmin(actor))) fail(403, 'Admin access required');

    const body = req.body || {};
    const propertyId = String(body.propertyId || '').trim();
    if (!propertyId || propertyId.includes('/') || propertyId.length > 150) {
      fail(400, 'A valid propertyId is required');
    }
    const platform = String(body.platform || '').trim().toLowerCase();
    let url;
    try {
      url = normalizePublishedSocialUrl(platform, body.url);
    } catch (_) {
      fail(400, 'Enter a valid HTTPS URL from the selected social platform');
    }
    const db = admin.firestore();
    const propertyRef = db.collection('properties').doc(propertyId);
    const privateRef = db.collection('propertyPrivate').doc(propertyId);

    await db.runTransaction(async tx => {
      const [snapshot, privateSnapshot] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef)
      ]);
      if (!snapshot.exists) fail(404, 'Property not found');
      const property = mergePropertyData(
        snapshot.data() || {},
        privateSnapshot.exists ? privateSnapshot.data() || {} : {}
      );
      if (String(property.status || '').toLowerCase() !== 'approved') {
        fail(409, 'Approve the property before publishing its social promotion');
      }
      const requested = Array.isArray(property.socialPromotionPlatforms)
        ? property.socialPromotionPlatforms.map(value => String(value || '').toLowerCase())
        : [];
      if (!requested.includes(platform)) {
        fail(409, 'This platform was not selected for this property');
      }
      const promotions = property.socialPromotions && typeof property.socialPromotions === 'object'
        ? property.socialPromotions
        : {};
      const promotion = promotions[platform] && typeof promotions[platform] === 'object'
        ? promotions[platform]
        : {};
      if (promotion.paymentStatus !== 'paid') {
        fail(409, 'This platform has not been paid for');
      }
      if (promotion.published === true || promotion.status === 'published' || promotion.url) {
        fail(409, 'This platform has already been published');
      }

      const paymentOrderId = String(promotion.paymentOrderId || '').trim();
      if (!paymentOrderId || paymentOrderId.includes('/') || paymentOrderId.length > 150) {
        fail(409, 'A verified Cashfree payment reference is missing for this platform');
      }
      const paymentRef = db.collection('payments').doc(paymentOrderId);
      const paymentSnapshot = await tx.get(paymentRef);
      if (!paymentSnapshot.exists || !isVerifiedSocialPromotionPayment({
        payment: paymentSnapshot.data() || {},
        propertyId,
        ownerId: property.ownerId,
        platform,
        paymentOrderId
      })) {
        fail(409, 'A successful Cashfree payment could not be verified for this property and platform');
      }

      const stamp = admin.firestore.FieldValue.serverTimestamp();
      tx.update(propertyRef, {
        [`socialPromotions.${platform}.paymentStatus`]: 'paid',
        [`socialPromotions.${platform}.status`]: 'published',
        [`socialPromotions.${platform}.published`]: true,
        [`socialPromotions.${platform}.url`]: url,
        [`socialPromotions.${platform}.publishedAt`]: stamp,
        [`socialPromotions.${platform}.publishedBy`]: actor.uid,
        updatedAt: stamp
      });
    });

    return res.status(200).json({
      success: true,
      propertyId,
      platform,
      url,
      status: 'published'
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) {
      console.error('admin-social-promotion:', error.message || 'Unknown error');
    }
    return res.status(status).json({
      success: false,
      error: status >= 500 ? 'Could not publish this social promotion.' : error.message
    });
  }
};
