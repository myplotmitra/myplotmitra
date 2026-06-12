// /api/rzp-create-order — creates a Razorpay order for the ₹10 contact unlock.
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, FIREBASE_SERVICE_ACCOUNT
// POST {propId} + Authorization: Bearer <Firebase idToken>
// → { keyId, orderId, amount, currency, title }
// Uses Razorpay Orders REST API directly (Basic auth) — no SDK needed.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const AMOUNT_PAISE = 1000; // ₹10 (minimum allowed is 100)

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
      return res.status(500).json({ error: 'Payment not configured' });

    // ── Auth ──
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idToken) return res.status(401).json({ error: 'Sign in required' });
    let user;
    try { user = await admin.auth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Invalid session — sign in again' }); }

    const { propId } = req.body || {};
    if (!propId) return res.status(400).json({ error: 'propId required' });
    if (AMOUNT_PAISE < 100) return res.status(400).json({ error: 'Amount below minimum' });

    const db = admin.firestore();

    // Already unlocked → don't charge twice
    const unlock = await db.collection('unlocks').doc(`${propId}_${user.uid}`).get();
    if (unlock.exists) return res.status(200).json({ error: 'Already unlocked — refresh the page.' });

    const prop = await db.collection('properties').doc(String(propId)).get();
    if (!prop.exists) return res.status(404).json({ error: 'Property not found' });
    const title = (prop.data().title || 'Property').slice(0, 60);

    // ── Create order ──
    const receipt = 'MPM' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
    const auth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: AMOUNT_PAISE,
        currency: 'INR',
        receipt,
        notes: { propId: String(propId), uid: user.uid },
      }),
    });
    const order = await r.json();
    if (!r.ok || !order.id) {
      console.error('Razorpay order error:', JSON.stringify(order));
      return res.status(500).json({ error: order?.error?.description || 'Order creation failed' });
    }

    await db.collection('payments').doc(order.id).set({
      gateway: 'razorpay',
      orderId: order.id, receipt,
      uid: user.uid, propId: String(propId),
      amount: AMOUNT_PAISE, status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: AMOUNT_PAISE,
      currency: 'INR',
      title,
    });
  } catch (e) {
    console.error('rzp-create-order:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
