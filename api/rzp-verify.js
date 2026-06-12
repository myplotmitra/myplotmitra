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

    await payRef.set({
      status: 'success',
      paymentId: razorpay_payment_id,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('unlocks').doc(`${pay.propId}_${pay.uid}`).set({
      propertyId: pay.propId, buyerId: pay.uid,
      orderId: razorpay_order_id, paymentId: razorpay_payment_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, propId: pay.propId });
  } catch (e) {
    console.error('rzp-verify:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
