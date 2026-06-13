// /api/rzp-verify — verifies the Razorpay payment signature and, only on a
// valid match, marks the payment paid and grants the contact unlock.
// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//      + Authorization: Bearer <Firebase idToken>
// Signature algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)

const admin = require('firebase-admin');
const crypto = require('crypto');

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

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ error: 'Missing payment fields' });

    // ── Verify signature ──
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    const valid =
      expected.length === String(razorpay_signature).length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));

    if (!valid) {
      console.error('rzp-verify: signature mismatch for', razorpay_order_id);
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    // ── Grant unlock ──
    const db = admin.firestore();
    const payRef = db.collection('payments').doc(razorpay_order_id);
    const snap = await payRef.get();
    if (!snap.exists) return res.status(400).json({ error: 'Unknown order' });
    const pay = snap.data();
    if (pay.uid !== user.uid) return res.status(403).json({ error: 'Order belongs to another user' });

    if (pay.status === 'success') {
      // idempotent: already processed (double-click / retry)
      return res.status(200).json({ success: true, prime: pay.kind === 'prime', propId: pay.propId || null });
    }

    await payRef.set({
      status: 'success',
      paymentId: razorpay_payment_id,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const userRef = db.collection('users').doc(pay.uid);

    if (pay.kind === 'prime') {
      // extend from current expiry if still active
      const uSnap = await userRef.get();
      const cur = uSnap.exists && uSnap.data().premiumUntil;
      const curMs = cur && cur.toMillis ? cur.toMillis() : 0;
      const base = Math.max(Date.now(), curMs);
      await userRef.set({ premiumUntil: new Date(base + 30 * 86400000) }, { merge: true });
      return res.status(200).json({ success: true, prime: true });
    }

    // flexy: grant the bundle, then consume 1 credit for this property
    const credits = Number(pay.credits) || 1;
    let creditsLeft = 0;
    await db.runTransaction(async (t) => {
      const u = await t.get(userRef);
      const cur = Number(u.exists && u.data().contactCredits) || 0;
      creditsLeft = cur + credits - 1; // bundle minus this unlock
      t.set(userRef, { contactCredits: creditsLeft }, { merge: true });
      t.set(db.collection('unlocks').doc(`${pay.propId}_${pay.uid}`), {
        propertyId: pay.propId, buyerId: pay.uid,
        orderId: razorpay_order_id, paymentId: razorpay_payment_id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({ success: true, propId: pay.propId, creditsLeft });
  } catch (e) {
    console.error('rzp-verify:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
