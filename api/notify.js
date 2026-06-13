// /api/notify — sends an FCM push to the other participant of a chat.
// Runs on Vercel (free tier). Requires env var FIREBASE_SERVICE_ACCOUNT
// (the full JSON of a Firebase service-account key).
//
// Called by the web app after a chat message is written:
//   POST /api/notify  { chatId, text }  with  Authorization: Bearer <idToken>

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    // 1. Verify the caller's Firebase ID token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'No token' });
    const caller = await admin.auth().verifyIdToken(idToken);

    const db = admin.firestore();
    const body = req.body || {};
    let toUid, title, msgBody;

    if (body.toUid) {
      // ── Direct push (contact request / approval) ──
      toUid = String(body.toUid);
      title = String(body.title || 'MyPlotMitra').slice(0, 80);
      msgBody = String(body.body || '').slice(0, 140);
    } else {
      // ── Chat message push ──
      const { chatId, text } = body;
      if (!chatId || !text) return res.status(400).json({ error: 'chatId and text required' });
      const chatSnap = await db.collection('chats').doc(String(chatId)).get();
      if (!chatSnap.exists) return res.status(404).json({ error: 'Chat not found' });
      const chat = chatSnap.data();
      if (!Array.isArray(chat.participants) || !chat.participants.includes(caller.uid)) {
        return res.status(403).json({ error: 'Not a participant' });
      }
      toUid = chat.participants.find((u) => u !== caller.uid);
      const senderName2 =
        caller.uid === chat.buyerId ? chat.buyerName : chat.sellerName;
      title = `${senderName2 || 'New message'} · ${chat.propertyTitle || 'MyPlotMitra'}`.slice(0, 80);
      msgBody = String(text).slice(0, 140);
    }

    if (!toUid) return res.status(200).json({ sent: 0 });
    const userSnap = await db.collection('users').doc(toUid).get();
    const tokens = (userSnap.exists && userSnap.data().fcmTokens) || [];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no tokens' });

    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title,
        body: msgBody,
        url: 'https://www.myplotmitra.com/',
      },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    });

    // 5. Prune dead tokens so the list stays clean
    const dead = [];
    result.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token') {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await db.collection('users').doc(toUid).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead),
      });
    }

    return res.status(200).json({ sent: result.successCount });
  } catch (e) {
    console.error('notify error:', e);
    return res.status(500).json({ error: 'send failed' });
  }
};
