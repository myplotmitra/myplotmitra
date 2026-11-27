'use strict';

const crypto = require('crypto');

function sameMoney(a, b) {
  return Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

function verifyCashfreeWebhookSignature(
  rawBody,
  timestamp,
  signature,
  secretKey
) {
  if (
    typeof rawBody !== 'string' ||
    !rawBody ||
    timestamp === undefined ||
    timestamp === null ||
    String(timestamp) === '' ||
    signature === undefined ||
    signature === null ||
    String(signature) === '' ||
    typeof secretKey !== 'string' ||
    !secretKey
  ) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(String(timestamp) + rawBody)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature));

  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isSuccessfulCashfreePayment(
  payment,
  orderId,
  expectedPaymentId
) {
  return !!(
    payment &&
    payment.payment_status === 'SUCCESS' &&
    String(payment.order_id || '') === String(orderId) &&
    (
      !expectedPaymentId ||
      String(payment.cf_payment_id || '') === String(expectedPaymentId)
    )
  );
}

function validateSuccessfulCashfreePayment(
  payment,
  orderId,
  expectedAmount,
  expectedCurrency = 'INR'
) {
  if (
    !payment ||
    payment.payment_status !== 'SUCCESS' ||
    String(payment.order_id || '') !== String(orderId)
  ) {
    throw new Error('Cashfree payment is not a verified success');
  }

  if (
    !sameMoney(payment.order_amount, expectedAmount) ||
    !sameMoney(payment.payment_amount, expectedAmount) ||
    String(
      payment.payment_currency ||
      payment.order_currency ||
      payment.currency ||
      ''
    ) !== String(expectedCurrency)
  ) {
    throw new Error(
      'Cashfree payment amount or currency does not match the order'
    );
  }

  if (
    payment.cf_payment_id === undefined ||
    payment.cf_payment_id === null ||
    String(payment.cf_payment_id) === ''
  ) {
    throw new Error('Cashfree payment reference is missing');
  }

  return true;
}

module.exports = {
  sameMoney,
  verifyCashfreeWebhookSignature,
  isSuccessfulCashfreePayment,
  validateSuccessfulCashfreePayment
};
