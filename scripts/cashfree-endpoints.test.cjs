'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCashfreeWebhookHandler,
  createCashfreeVerifyHandler
} = require('../api/_cashfree-endpoints');

function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function makeDb(record, exists = true) {
  return {
    collection(name) {
      assert.equal(name, 'payments');
      return {
        doc(id) {
          return {
            async get() {
              return {
                exists,
                id,
                data: () => record
              };
            }
          };
        }
      };
    }
  };
}

function webhookEvent(overrides = {}) {
  return JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: {
        order_id: 'MPM_TEST_001'
      },
      payment: {
        cf_payment_id: '123456789',
        payment_status: 'SUCCESS',
        ...overrides
      }
    }
  });
}

function webhookDeps(overrides = {}) {
  return {
    db: makeDb({ gateway: 'cashfree', uid: 'user-1' }),
    verifyWebhookSignature: () => true,
    getSuccessfulPayment: async () => ({
      cf_payment_id: '123456789',
      payment_status: 'SUCCESS'
    }),
    fulfilCashfreeOrder: async () => ({
      success: true,
      needsReview: false
    }),
    ...overrides
  };
}

function webhookRequest(body = webhookEvent()) {
  return {
    method: 'POST',
    rawBody: body,
    headers: {
      'x-webhook-signature': 'test-signature',
      'x-webhook-timestamp': '1700000000'
    }
  };
}

test('webhook rejects non-POST methods', async () => {
  const handler = createCashfreeWebhookHandler(webhookDeps());
  const res = makeResponse();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 405);
});

test('webhook rejects invalid signatures before database lookup', async () => {
  const deps = webhookDeps({
    verifyWebhookSignature: () => false,
    db: {
      collection() {
        throw new Error('Database must not be accessed');
      }
    }
  });

  const handler = createCashfreeWebhookHandler(deps);
  const res = makeResponse();

  await handler(webhookRequest(), res);

  assert.equal(res.statusCode, 400);
});

test('webhook ignores pending payment events', async () => {
  const deps = webhookDeps({
    db: {
      collection() {
        throw new Error('Pending events must not access database');
      }
    }
  });

  const handler = createCashfreeWebhookHandler(deps);
  const res = makeResponse();

  await handler(
    webhookRequest(webhookEvent({ payment_status: 'PENDING' })),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ignored, true);
});

test('webhook rejects malformed JSON after signature verification', async () => {
  const handler = createCashfreeWebhookHandler(webhookDeps());
  const res = makeResponse();

  await handler(webhookRequest('{invalid-json'), res);

  assert.equal(res.statusCode, 400);
});

test('webhook ignores an unknown payment order', async () => {
  const deps = webhookDeps({
    db: makeDb(null, false)
  });

  const handler = createCashfreeWebhookHandler(deps);
  const res = makeResponse();

  await handler(webhookRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ignored, true);
});

test('webhook returns 503 while successful payment is not yet available', async () => {
  const deps = webhookDeps({
    getSuccessfulPayment: async () => null
  });

  const handler = createCashfreeWebhookHandler(deps);
  const res = makeResponse();

  await handler(webhookRequest(), res);

  assert.equal(res.statusCode, 503);
});

test('webhook verifies the Cashfree payment before fulfilment', async () => {
  let verifiedOrderId;
  let verifiedPaymentId;
  let fulfilmentCount = 0;

  const deps = webhookDeps({
    getSuccessfulPayment: async (orderId, paymentId) => {
      verifiedOrderId = orderId;
      verifiedPaymentId = paymentId;
      return { payment_status: 'SUCCESS' };
    },
    fulfilCashfreeOrder: async () => {
      fulfilmentCount++;
      return { needsReview: false };
    }
  });

  const handler = createCashfreeWebhookHandler(deps);
  const res = makeResponse();

  await handler(webhookRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.processed, true);
  assert.equal(verifiedOrderId, 'MPM_TEST_001');
  assert.equal(verifiedPaymentId, '123456789');
  assert.equal(fulfilmentCount, 1);
});

test('webhook enforces body-size limit for pre-populated Buffer bodies', async () => {
  const handler = createCashfreeWebhookHandler(webhookDeps());
  const req = webhookRequest(Buffer.alloc(1024 * 1024 + 1));
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 413);
});

test('verification rejects non-POST methods', async () => {
  const handler = createCashfreeVerifyHandler(webhookDeps({
    authenticate: async () => ({ uid: 'user-1' })
  }));

  const res = makeResponse();

  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 405);
});

test('verification rejects unauthenticated users', async () => {
  const deps = webhookDeps({
    authenticate: async () => {
      const error = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 401);
});

test('verification rejects invalid order identifiers', async () => {
  const deps = webhookDeps({
    authenticate: async () => ({ uid: 'user-1' })
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'bad/order' } },
    res
  );

  assert.equal(res.statusCode, 400);
});

test('verification rejects another user payment order', async () => {
  const deps = webhookDeps({
    db: makeDb({
      gateway: 'cashfree',
      uid: 'another-user',
      status: 'created'
    }),
    authenticate: async () => ({ uid: 'user-1' })
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 403);
});

test('verification returns 404 for a missing payment record', async () => {
  const deps = webhookDeps({
    db: makeDb(null, false),
    authenticate: async () => ({ uid: 'user-1' })
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 404);
});

test('verification returns already-processed status without another payment lookup', async () => {
  let lookupCount = 0;

  const deps = webhookDeps({
    db: makeDb({
      gateway: 'cashfree',
      uid: 'user-1',
      status: 'success',
      kind: 'prime'
    }),
    authenticate: async () => ({ uid: 'user-1' }),
    getSuccessfulPayment: async () => {
      lookupCount++;
      throw new Error('Already-processed payment must not be queried');
    }
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.alreadyProcessed, true);
  assert.equal(lookupCount, 0);
});

test('verification does not process orders that are not created', async () => {
  const deps = webhookDeps({
    db: makeDb({
      gateway: 'cashfree',
      uid: 'user-1',
      status: 'creating'
    }),
    authenticate: async () => ({ uid: 'user-1' })
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 409);
});

test('verification keeps pending payments unfulfilled', async () => {
  let fulfilmentCount = 0;

  const deps = webhookDeps({
    db: makeDb({
      gateway: 'cashfree',
      uid: 'user-1',
      status: 'created'
    }),
    authenticate: async () => ({ uid: 'user-1' }),
    getSuccessfulPayment: async () => null,
    fulfilCashfreeOrder: async () => {
      fulfilmentCount++;
    }
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.paymentStatus, 'pending');
  assert.equal(fulfilmentCount, 0);
});

test('verification fulfils a verified successful payment', async () => {
  let fulfilmentCount = 0;

  const deps = webhookDeps({
    db: makeDb({
      gateway: 'cashfree',
      uid: 'user-1',
      status: 'created'
    }),
    authenticate: async () => ({ uid: 'user-1' }),
    getSuccessfulPayment: async () => ({
      payment_status: 'SUCCESS',
      order_id: 'MPM_TEST_001'
    }),
    fulfilCashfreeOrder: async () => {
      fulfilmentCount++;
      return { success: true, kind: 'prime' };
    }
  });

  const handler = createCashfreeVerifyHandler(deps);
  const res = makeResponse();

  await handler(
    { method: 'POST', body: { orderId: 'MPM_TEST_001' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(fulfilmentCount, 1);
});
