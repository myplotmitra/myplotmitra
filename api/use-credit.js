'use strict';

const { admin, authenticate } = require('./_r2');
const { resolveOwnerId } = require('./_property-contact-policy');
const { canUnlockContactFor } = require('./_property-policy');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);
    const propertyId = String((req.body || {}).propId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(propertyId)) {
      fail(400, 'Valid property ID required');
    }

    const db = admin.firestore();
    const propertyRef = db.collection('properties').doc(propertyId);
    const privateRef = db.collection('propertyPrivate').doc(propertyId);
    const unlockRef = db.collection('unlocks').doc(`${propertyId}_${actor.uid}`);
    const userRef = db.collection('users').doc(actor.uid);

    const result = await db.runTransaction(async tx => {
      const [propertySnap, privateSnap, unlockSnap, userSnap] = await Promise.all([
        tx.get(propertyRef),
        tx.get(privateRef),
        tx.get(unlockRef),
        tx.get(userRef),
      ]);

      if (!propertySnap.exists) fail(404, 'Property not found');
      const publicData = propertySnap.data() || {};
      const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
      const ownerId = resolveOwnerId(publicData, privateData, privateSnap.exists);
      const property = { ...publicData, ownerId };

      if (!ownerId || !canUnlockContactFor(property, actor.uid)) {
        fail(409, 'Seller contact cannot be unlocked for this listing');
      }

      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const currentCredits = Number(userData.contactCredits) || 0;
      const credits = Number.isSafeInteger(currentCredits) && currentCredits > 0
        ? currentCredits
        : 0;

      // An existing valid unlock is idempotent: never charge another credit.
      if (unlockSnap.exists) {
        const existing = unlockSnap.data() || {};
        if (String(existing.buyerId || '') !== actor.uid ||
            String(existing.propertyId || '') !== propertyId) {
          fail(409, 'Existing contact unlock record needs review');
        }
        return { success: true, alreadyUnlocked: true, creditsLeft: credits };
      }

      if (credits < 1) fail(409, 'No contact credits left');

      const creditsLeft = credits - 1;
      tx.set(userRef, { contactCredits: creditsLeft }, { merge: true });
      tx.create(unlockRef, {
        propertyId,
        buyerId: actor.uid,
        via: 'credit',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, alreadyUnlocked: false, creditsLeft };
    });

    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(error.message || '') ? 401 : 500);
    if (status >= 500) console.error('use-credit:', error.message || 'Unknown error');
    return res.status(status).json({
      success: false,
      error: status === 401 ? 'Please sign in again' :
        status < 500 ? error.message : 'Could not unlock seller contact',
    });
  }
};
