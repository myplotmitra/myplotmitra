'use strict';

const { admin, authenticate, isAdmin } = require('./_r2');
const {
  resolveOwnerId,
  canReadSellerContact,
  normalizeIndianPhone,
  hasActivePremium,
  hasApprovedContactRequest,
} = require('./_property-contact-policy');

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);
    const propertyId = String((req.body || {}).propId || '').trim();
    if (!validId(propertyId)) {
      return res.status(400).json({ success: false, error: 'Valid property ID required' });
    }

    const db = admin.firestore();
    const [propertySnap, privateSnap, contactSnap, unlockSnap, userSnap, settingsSnap, requestSnap] = await Promise.all([
      db.collection('properties').doc(propertyId).get(),
      db.collection('propertyPrivate').doc(propertyId).get(),
      db.collection('propertyContactInfo').doc(propertyId).get(),
      db.collection('unlocks').doc(`${propertyId}_${actor.uid}`).get(),
      db.collection('users').doc(actor.uid).get(),
      db.collection('settings').doc('app').get(),
      db.collection('contactRequests').doc(`${propertyId}_${actor.uid}`).get(),
    ]);

    if (!propertySnap.exists) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }

    const publicData = propertySnap.data() || {};
    const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
    const ownerId = resolveOwnerId(publicData, privateData, privateSnap.exists);

    // A present private owner record is authoritative. Do not fall back to a
    // stale public ownerId if that record is malformed or incomplete.
    if (!ownerId) {
      return res.status(409).json({ success: false, error: 'Seller ownership information needs review' });
    }

    const unlock = unlockSnap.exists ? unlockSnap.data() || {} : null;
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
    const requestData = requestSnap.exists ? requestSnap.data() || {} : null;
    const listingEligible = ['approved', 'sold'].includes(String(publicData.status || ''));
    const adminAccess = await isAdmin(actor);
    const ownerAccess = ownerId === actor.uid;
    const unlockAccess = canReadSellerContact({
      publicData: { ...publicData, id: propertyId },
      privateData,
      privateExists: privateSnap.exists,
      buyerUid: actor.uid,
      propertyId,
      unlockRecord: unlock,
    });
    const premiumAccess = settings.prime === true && listingEligible &&
      hasActivePremium(userData);
    const requestAccess = settings.prime !== true && listingEligible &&
      hasApprovedContactRequest(requestData, {
        propertyId,
        buyerUid: actor.uid,
        ownerId,
      });
    const hasAccess = adminAccess || ownerAccess || unlockAccess ||
      premiumAccess || requestAccess;

    if (!hasAccess) {
      const credits = Number(userData.contactCredits) || 0;
      return res.status(200).json({
        success: true,
        unlocked: false,
        primeEnabled: settings.prime === true,
        requestStatus: requestData && typeof requestData.status === 'string'
          ? requestData.status
          : null,
        creditsLeft: Number.isSafeInteger(credits) && credits > 0 ? credits : 0,
      });
    }

    const contactData = contactSnap.exists ? contactSnap.data() || {} : {};
    const phone = normalizeIndianPhone(
      typeof contactData.sellerPhone === 'string' && contactData.sellerPhone.trim()
        ? contactData.sellerPhone
        : privateData.sellerPhone
    );
    if (!phone) {
      return res.status(409).json({
        success: false,
        error: 'Seller contact information is unavailable. Please contact support.',
      });
    }

    const ownerName = String(
      contactData.ownerName || privateData.ownerName || 'Seller'
    ).trim().slice(0, 120) || 'Seller';

    return res.status(200).json({
      success: true,
      unlocked: true,
      ownerName,
      sellerPhone: phone,
    });
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(error.message || '') ? 401 : 500);
    if (status >= 500) console.error('property-contact:', error.message || 'Unknown error');
    return res.status(status).json({
      success: false,
      error: status === 401 ? 'Please sign in again' :
        status < 500 ? error.message : 'Could not retrieve seller contact details',
    });
  }
};
