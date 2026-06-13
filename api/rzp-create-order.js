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

    const { kind = 'flexy', propId = null } = req.body || {};
    if (!['prime', 'flexy'].includes(kind))
      return res.status(400).json({ error: 'Invalid kind' });

    const db = admin.firestore();

    // Prices come from admin settings — never from the client
    const cfgSnap = await db.collection('settings').doc('app').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const primePrice = Number(cfg.primePrice) || 25;
    const flexyCount = Number(cfg.flexyCount) || 3;
    const flexyPrice = Number(cfg.flexyPrice) || 10;

    let AMOUNT_PAISE, label, credits = 0;
    if (kind === 'prime') {
      AMOUNT_PAISE = Math.round(primePrice * 100);
      label = `Prime subscription — 30 days (₹${primePrice})`;
    } else {
      if (!propId) return res.status(400).json({ error: 'propId required' });
      const unlock = await db.collection('unlocks').doc(`${propId}_${user.uid}`).get();
      if (unlock.exists) return res.status(200).json({ error: 'Already unlocked — refresh the page.' });
      const prop = await db.collection('properties').doc(String(propId)).get();
      if (!prop.exists) return res.status(404).json({ error: 'Property not found' });
      AMOUNT_PAISE = Math.round(flexyPrice * 100);
      credits = flexyCount;
      label = `${flexyCount} seller contact${flexyCount > 1 ? 's' : ''} (₹${flexyPrice})`;
    }
    if (AMOUNT_PAISE < 100) return res.status(400).json({ error: 'Amount below minimum (₹1)' });
    const title = label;

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
        notes: { kind, propId: propId ? String(propId) : '', uid: user.uid },
      }),
    });
    const order = await r.json();
    if (!r.ok || !order.id) {
      console.error('Razorpay order error:', JSON.stringify(order));
      return res.status(500).json({ error: order?.error?.description || 'Order creation failed' });
    }

    await db.collection('payments').doc(order.id).set({
      gateway: 'razorpay', kind,
      orderId: order.id, receipt,
      uid: user.uid, propId: propId ? String(propId) : null,
      credits,
      amount: AMOUNT_PAISE, status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: AMOUNT_PAISE,
      currency: 'INR',
      title,
      label,
    });
  } catch (e) {
    console.error('rzp-create-order:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
