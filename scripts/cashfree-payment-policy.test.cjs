'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  verifyCashfreeWebhookSignature,
  isSuccessfulCashfreePayment,
  validateSuccessfulCashfreePayment
} = require('../api/_cashfree-policy');

const secret = 'cashfree-test-secret-not-used-in-production';
const timestamp = '1700000000';

function makeSignature(body, time = timestamp) {
  return crypto
    .createHmac('sha256', secret)
    .update(time + body)
    .digest('base64');
}

function validPayment(overrides = {}) {
  return {
    payment_status: 'SUCCESS',
    order_id: 'MPM_TEST_001',
    cf_payment_id: '123456789',
    order_amount: 25,
    payment_amount: 25,
    payment_currency: 'INR',
    ...overrides
  };
}

test('accepts a valid Cashfree webhook signature', () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';

  assert.equal(
    verifyCashfreeWebhookSignature(
      body, timestamp, makeSignature(body), secret
    ),
    true
  );
});

test('rejects a modified webhook body', () => {
  const original = '{"amount":25}';
  const signature = makeSignature(original);

  assert.equal(
    verifyCashfreeWebhookSignature(
      '{"amount":250}', timestamp, signature, secret
    ),
    false
  );
});

test('rejects an incorrect webhook signature', () => {
  assert.equal(
    verifyCashfreeWebhookSignature(
      '{"type":"PAYMENT_SUCCESS_WEBHOOK"}',
      timestamp,
      'incorrect-signature',
      secret
    ),
    false
  );
});

test('rejects missing webhook signature inputs', () => {
  assert.equal(
    verifyCashfreeWebhookSignature('', timestamp, 'signature', secret),
    false
  );

  assert.equal(
    verifyCashfreeWebhookSignature('{}', '', 'signature', secret),
    false
  );

  assert.equal(
    verifyCashfreeWebhookSignature('{}', timestamp, '', secret),
    false
  );

  assert.equal(
    verifyCashfreeWebhookSignature('{}', timestamp, 'signature', ''),
    false
  );
});

test('accepts the correct successful payment for an order', () => {
  assert.equal(
    isSuccessfulCashfreePayment(
      validPayment(), 'MPM_TEST_001', '123456789'
    ),
    true
  );
});

test('rejects payment belonging to a different order', () => {
  assert.equal(
    isSuccessfulCashfreePayment(
      validPayment(), 'MPM_ANOTHER_ORDER'
    ),
    false
  );
});

test('rejects a payment with an unexpected payment ID', () => {
  assert.equal(
    isSuccessfulCashfreePayment(
      validPayment(), 'MPM_TEST_001', '999999'
    ),
    false
  );
});

test('does not select pending or failed payment attempts', () => {
  assert.equal(
    isSuccessfulCashfreePayment(
      validPayment({ payment_status: 'PENDING' }),
      'MPM_TEST_001'
    ),
    false
  );

  assert.equal(
    isSuccessfulCashfreePayment(
      validPayment({ payment_status: 'FAILED' }),
      'MPM_TEST_001'
    ),
    false
  );
});

test('accepts a matching amount, currency and payment reference', () => {
  assert.equal(
    validateSuccessfulCashfreePayment(
      validPayment(), 'MPM_TEST_001', 25, 'INR'
    ),
    true
  );
});

test('rejects an incorrect order amount', () => {
  assert.throws(
    () => validateSuccessfulCashfreePayment(
      validPayment({ order_amount: 250 }),
      'MPM_TEST_001', 25, 'INR'
    ),
    /amount or currency/
  );
});

test('rejects an incorrect payment amount', () => {
  assert.throws(
    () => validateSuccessfulCashfreePayment(
      validPayment({ payment_amount: 20 }),
      'MPM_TEST_001', 25, 'INR'
    ),
    /amount or currency/
  );
});

test('rejects an incorrect currency', () => {
  assert.throws(
    () => validateSuccessfulCashfreePayment(
      validPayment({ payment_currency: 'USD' }),
      'MPM_TEST_001', 25, 'INR'
    ),
    /amount or currency/
  );
});

test('rejects payment without a Cashfree payment reference', () => {
  assert.throws(
    () => validateSuccessfulCashfreePayment(
      validPayment({ cf_payment_id: null }),
      'MPM_TEST_001', 25, 'INR'
    ),
    /payment reference is missing/
  );
});

test('rejects a successful payment response for another order', () => {
  assert.throws(
    () => validateSuccessfulCashfreePayment(
      validPayment({ order_id: 'OTHER_ORDER' }),
      'MPM_TEST_001', 25, 'INR'
    ),
    /verified success/
  );
});
