'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDispatcher, readRouteKey } = require('../api/_route-dispatcher');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const expected = {
  '/api/use-credit': ['/api/contacts.js', 'use-credit'],
  '/api/contact-request': ['/api/contacts.js', 'contact-request'],
  '/api/property-contact': ['/api/contacts.js', 'property-contact'],
  '/api/my-properties': ['/api/properties.js', 'my-properties'],
  '/api/property-update': ['/api/properties.js', 'property-update'],
  '/api/property-mark-sold': ['/api/properties.js', 'property-mark-sold'],
  '/api/r2-delete-property': ['/api/properties.js', 'r2-delete-property'],
  '/api/property-create': ['/api/properties.js', 'property-create'],
  '/api/rental-draft-create': ['/api/properties.js', 'rental-draft-create'],
  '/api/r2-upload-url': ['/api/r2.js', 'r2-upload-url'],
  '/api/r2-finalize-upload': ['/api/r2.js', 'r2-finalize-upload'],
  '/api/r2-cleanup-uploads': ['/api/r2.js', 'r2-cleanup-uploads'],
};

test('Hobby deployment config contains no more than 12 API functions', () => {
  const apiBuilds = config.builds.filter(item => /^api\//.test(item.src));
  assert.equal(apiBuilds.length, 8);
  assert.ok(apiBuilds.length <= 12);
  for (const file of ['api/contacts.js', 'api/properties.js', 'api/r2.js']) {
    assert.ok(apiBuilds.some(item => item.src === file), `${file} must be a built function`);
  }
});

test('all existing grouped API URLs still map to an allow-listed dispatcher operation', () => {
  const routes = new Map(config.routes.map(route => [route.src, route.dest]));
  for (const [source, [file, operation]] of Object.entries(expected)) {
    const dest = routes.get(source);
    assert.equal(dest, `${file}?__mpm_route=${operation}`, `${source} route destination`);
  }
});

test('Cashfree webhook remains a standalone function with its original public route', () => {
  assert.ok(config.builds.some(item => item.src === 'api/cashfree-webhook.js'));
  const webhookRoute = config.routes.find(route => route.src === '/api/cashfree-webhook');
  assert.equal(webhookRoute && webhookRoute.dest, '/api/cashfree-webhook.js');
});

test('dispatcher reads route from Vercel query without rewriting request body', async () => {
  const body = { propId: 'p123' };
  const req = { method: 'POST', query: { __mpm_route: 'property-create' }, body };
  let called = false;
  const dispatch = createDispatcher({
    'property-create': async (actualReq, res) => {
      called = true;
      assert.equal(actualReq, req);
      assert.equal(actualReq.body, body);
      return res.status(201).json({ success: true });
    },
  });
  const result = await dispatch(req, {
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  assert.equal(called, true);
  assert.equal(result.code, 201);
  assert.deepEqual(result.payload, { success: true });
});

test('dispatcher rejects unknown or array-valued operations', async () => {
  assert.equal(readRouteKey({ query: { __mpm_route: ['property-create'] } }), null);
  const dispatch = createDispatcher({ 'property-create': async () => assert.fail('must not dispatch') });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await dispatch({ query: { __mpm_route: 'unknown' } }, response);
  assert.equal(response.code, 404);
  assert.deepEqual(response.payload, { success: false, error: 'API route not found' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});
