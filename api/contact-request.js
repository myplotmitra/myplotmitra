'use strict';

const { admin, authenticate, isAdmin } = require('./_r2');
const {
  resolveOwnerId,
  canReadSellerContact,
  hasActivePremium,
} = require('./_property-contact-policy');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

module.exports = async function contactRequestHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);
    const body = req.body || {};
    const allowedKeys = new Set(['propId']);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !allowedKeys.has(key))) {
      fail(400, 'Invalid contact request');
    }

    const propertyId = String(body.propId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(propertyId)) {
      fail(400, 'Valid property ID required');
    }

    const db = admin.firestore();
    const propertyRef = db.collection('properties').doc(propertyId);
    const privateRef = db.collection('propertyPrivate').doc(propertyId);
    const buyerRef = db.collection('users').doc(actor.uid);
    const settingsRef = db.collection('settings').doc('app');
    const unlockRef = db.collection('unlocks').doc(`${propertyId}_${actor.uid}`);
    const adminAccess = await isAdmin(actor);
    const requestRef = db.collection('contactRequests')
      .doc(`${propertyId}_${actor.uid}`);

    const result = await db.runTransaction(async tx => {
      const [propertySnap, privateSnap, buyerSnap, settingsSnap, unlockSnap, requestSnap] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef),
        tx.get(buyerRef),
        tx.get(settingsRef),
        tx.get(unlockRef),
        tx.get(requestRef),
      ]);

      if (!propertySnap.exists) fail(404, 'Property not found');
      const property = propertySnap.data() || {};
      if (!['approved', 'sold'].includes(String(property.status || ''))) {
        fail(409, 'Seller contact requests are available only for approved listings');
      }

      const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
      const ownerId = resolveOwnerId(property, privateData, privateSnap.exists);
      if (!ownerId) fail(409, 'Seller ownership information needs review');
      if (ownerId === actor.uid) fail(403, 'You cannot request your own contact number');

      const buyerData = buyerSnap.exists ? buyerSnap.data() || {} : {};
      const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
      const unlockRecord = unlockSnap.exists ? unlockSnap.data() || {} : null;
      if (settings.prime === true) {
        const unlockAccess = canReadSellerContact({
          publicData: { ...property, id: propertyId },
          privateData,
          privateExists: privateSnap.exists,
          buyerUid: actor.uid,
          propertyId,
          unlockRecord,
        });
        if (!adminAccess && !hasActivePremium(buyerData) && !unlockAccess) {
          fail(403, 'Prime is enabled. Subscribe or unlock this seller before requesting contact.');
        }
        return { success: true, alreadyAuthorized: true, status: 'authorized' };
      }
      const buyerName = String(
        buyerData.displayName || buyerData.name || actor.name ||
        (actor.email ? actor.email.split('@')[0] : 'Buyer')
      ).trim().slice(0, 100) || 'Buyer';

      if (requestSnap.exists) {
        const existing = requestSnap.data() || {};
        if (String(existing.buyerId || '') !== actor.uid ||
            String(existing.propertyId || '') !== propertyId ||
            String(existing.sellerId || '') !== ownerId) {
          fail(409, 'Existing contact request needs review');
        }
        if (existing.status === 'approved') {
          return { success: true, alreadyApproved: true, status: 'approved' };
        }
        if (existing.status === 'pending') {
          return { success: true, alreadyPending: true, status: 'pending' };
        }
      }

      const stamp = admin.firestore.FieldValue.serverTimestamp();
      tx.set(requestRef, {
        propertyId,
        propertyTitle: String(property.title || '').slice(0, 180),
        buyerId: actor.uid,
        buyerName,
        sellerId: ownerId,
        status: 'pending',
        createdAt: stamp,
        updatedAt: stamp,
      });

      return { success: true, status: 'pending', alreadyPending: false };
    });

    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(error.message || '') ? 401 : 500);
    if (status >= 500) console.error('contact-request:', error.message || 'Unknown error');
    return res.status(status).json({
      success: false,
      error: status === 401 ? 'Please sign in again' :
        status < 500 ? error.message : 'Could not send the seller contact request',
    });
  }
};
