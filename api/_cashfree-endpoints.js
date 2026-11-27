'use strict';

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

async function readRawBody(req) {
  let body;

  if (Buffer.isBuffer(req.rawBody)) {
    body = req.rawBody;
  } else if (typeof req.rawBody === 'string') {
    body = Buffer.from(req.rawBody, 'utf8');
  } else {
    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
      const part = Buffer.from(chunk);
      total += part.length;

      if (total > MAX_WEBHOOK_BODY_BYTES) {
        const error = new Error('Webhook payload too large');
        error.code = 'WEBHOOK_PAYLOAD_TOO_LARGE';
        throw error;
      }

      chunks.push(part);
    }

    body = Buffer.concat(chunks);
  }

  // Apply the same limit to streamed, string and Buffer bodies.
  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    const error = new Error('Webhook payload too large');
    error.code = 'WEBHOOK_PAYLOAD_TOO_LARGE';
    throw error;
  }

  return body.toString('utf8');
}

function validOrderId(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9_-]{3,50}$/.test(value);
}

function createCashfreeWebhookHandler(deps) {
  const {
    db,
    verifyWebhookSignature,
    getSuccessfulPayment,
    fulfilCashfreeOrder
  } = deps;

  if (
    !db ||
    typeof verifyWebhookSignature !== 'function' ||
    typeof getSuccessfulPayment !== 'function' ||
    typeof fulfilCashfreeOrder !== 'function'
  ) {
    throw new Error('Cashfree webhook dependencies are incomplete');
  }

  return async function cashfreeWebhookHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    try {
      const rawBody = await readRawBody(req);
      const headers = req.headers || {};

      const signature = headers['x-webhook-signature'];
      const timestamp = headers['x-webhook-timestamp'];

      if (!verifyWebhookSignature(rawBody, timestamp, signature)) {
        return res.status(400).json({
          error: 'Invalid Cashfree webhook signature'
        });
      }

      const event = JSON.parse(rawBody);
      const data = event.data || {};
      const eventPayment = data.payment || {};
      const eventOrder = data.order || {};

      const orderId = String(
        eventOrder.order_id || eventPayment.order_id || ''
      ).trim();

      if (!orderId) {
        return res.status(200).json({
          received: true,
          ignored: true
        });
      }

      if (!validOrderId(orderId)) {
        return res.status(400).json({
          error: 'Invalid Cashfree order reference'
        });
      }

      // Never fulfil pending, failed or user-dropped payments.
      if (eventPayment.payment_status !== 'SUCCESS') {
        return res.status(200).json({
          received: true,
          ignored: true,
          paymentStatus: eventPayment.payment_status || 'unknown'
        });
      }

      const paySnap = await db.collection('payments').doc(orderId).get();

      if (!paySnap.exists || paySnap.data().gateway !== 'cashfree') {
        return res.status(200).json({
          received: true,
          ignored: true,
          reason: 'Unknown order'
        });
      }

      const paymentId = eventPayment.cf_payment_id
        ? String(eventPayment.cf_payment_id)
        : null;

      // Recheck payment independently with Cashfree.
      const payment = await getSuccessfulPayment(orderId, paymentId);

      if (!payment) {
        return res.status(503).json({
          error: 'Successful payment not yet available for verification'
        });
      }

      const result = await fulfilCashfreeOrder(orderId, payment);

      return res.status(200).json({
        received: true,
        processed: true,
        needsReview: !!result.needsReview
      });
    } catch (error) {
      console.error(
        'cashfree-webhook:',
        error.message || 'Unknown error'
      );

      const status = error.code === 'WEBHOOK_PAYLOAD_TOO_LARGE'
        ? 413
        : (error instanceof SyntaxError ? 400 : 503);

      return res.status(status).json({
        error: status === 400
          ? 'Invalid webhook payload'
          : status === 413
            ? 'Webhook payload too large'
            : 'Webhook processing temporarily unavailable'
      });
    }
  };
}

function createCashfreeVerifyHandler(deps) {
  const {
    db,
    authenticate,
    getSuccessfulPayment,
    fulfilCashfreeOrder
  } = deps;

  if (
    !db ||
    typeof authenticate !== 'function' ||
    typeof getSuccessfulPayment !== 'function' ||
    typeof fulfilCashfreeOrder !== 'function'
  ) {
    throw new Error('Cashfree verification dependencies are incomplete');
  }

  return async function cashfreeVerifyHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    try {
      const user = await authenticate(req);
      const orderId = String((req.body || {}).orderId || '').trim();

      if (!orderId) {
        return res.status(400).json({ error: 'orderId required' });
      }

      if (!validOrderId(orderId)) {
        return res.status(400).json({
          error: 'Invalid order ID'
        });
      }

      const payRef = db.collection('payments').doc(orderId);
      const snap = await payRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          error: 'Payment order not found'
        });
      }

      const pay = snap.data();

      if (pay.gateway !== 'cashfree' || pay.uid !== user.uid) {
        return res.status(403).json({
          error: 'This payment order does not belong to your account'
        });
      }

      if (pay.status === 'success') {
        return res.status(200).json({
          success: true,
          alreadyProcessed: true,
          kind: pay.kind,
          propId: pay.propId || null,
          creditsLeft: pay.creditsLeft,
          needsReview: pay.fulfilmentStatus === 'needs_review'
        });
      }

      if (pay.status !== 'created') {
        return res.status(409).json({
          success: false,
          error: 'This Cashfree order is not ready for verification'
        });
      }

      const payment = await getSuccessfulPayment(orderId);

      if (!payment) {
        return res.status(200).json({
          success: false,
          paymentStatus: 'pending',
          message: 'Payment is not confirmed yet. Do not pay again; refresh and check shortly.'
        });
      }

      const result = await fulfilCashfreeOrder(orderId, payment);

      return res.status(200).json(result);
    } catch (error) {
      console.error(
        'cashfree-verify:',
        error.message || 'Unknown error'
      );

      return res.status(Number(error.status) || 500).json({
        error: error.status
          ? error.message
          : 'Payment verification failed. Do not pay again; contact support if money was debited.'
      });
    }
  };
}

module.exports = {
  readRawBody,
  createCashfreeWebhookHandler,
  createCashfreeVerifyHandler
};
