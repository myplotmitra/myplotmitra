// /api/use-credit — spends 1 contact credit to unlock a property's seller.
// POST {propId} + Authorization: Bearer <Firebase idToken>
// → { success:true, creditsLeft } | { error }

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idToken) return res.status(401).json({ error: 'Sign in required' });
    let user;
    try { user = await admin.auth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Invalid session' }); }

    const { propId } = req.body || {};
    if (!propId) return res.status(400).json({ error: 'propId required' });

    const db = admin.firestore();
    const unlockRef = db.collection('unlocks').doc(`${propId}_${user.uid}`);
    const already = await unlockRef.get();
    if (already.exists) {
      const u = await db.collection('users').doc(user.uid).get();
      return res.status(200).json({ success: true,
        creditsLeft: Number(u.exists && u.data().contactCredits) || 0 });
    }

    const prop = await db.collection('properties').doc(String(propId)).get();
    if (!prop.exists) return res.status(404).json({ error: 'Property not found' });

    const userRef = db.collection('users').doc(user.uid);
    let creditsLeft = 0;
    let ok = false;
    await db.runTransaction(async (t) => {
      const u = await t.get(userRef);
      const cur = Number(u.exists && u.data().contactCredits) || 0;
      if (cur < 1) { ok = false; return; }
      ok = true;
      creditsLeft = cur - 1;
      t.set(userRef, { contactCredits: creditsLeft }, { merge: true });
      t.set(unlockRef, {
        propertyId: String(propId), buyerId: user.uid,
        via: 'credit',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    if (!ok) return res.status(200).json({ error: 'No contact credits left' });
    return res.status(200).json({ success: true, creditsLeft });
  } catch (e) {
    console.error('use-credit:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
