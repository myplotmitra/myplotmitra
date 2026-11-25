'use strict';

const assert = require('node:assert/strict');

const {
  normalizeDeleteRequest,
  resolveOwnerId,
  validatePropertyDelete
} = require('../api/_property-delete-policy');

function test(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

test('Valid property deletion request accepted', () => {
  assert.deepEqual(
    normalizeDeleteRequest({ propertyId: 'listing_123' }),
    { propertyId: 'listing_123' }
  );
});

test('Invalid IDs and additional request fields rejected', () => {
  assert.equal(normalizeDeleteRequest({ propertyId: '../other' }), null);
  assert.equal(normalizeDeleteRequest({ propertyId: 'x', ownerId: 'uid' }), null);
  assert.equal(normalizeDeleteRequest([]), null);
  assert.equal(normalizeDeleteRequest(null), null);
});

test('Private owner record is authoritative', () => {
  assert.equal(
    resolveOwnerId(
      { ownerId: 'public-owner' },
      { ownerId: 'private-owner' },
      true
    ),
    'private-owner'
  );
});

test('Missing owner in existing private record fails closed', () => {
  assert.equal(
    resolveOwnerId({ ownerId: 'public-owner' }, {}, true),
    ''
  );
});

test('Legacy public owner fallback works when private record is absent', () => {
  assert.equal(
    resolveOwnerId({ ownerId: 'legacy-owner' }, {}, false),
    'legacy-owner'
  );
});

test('Only matching owner can delete', () => {
  assert.deepEqual(
    validatePropertyDelete({
      actorUid: 'owner-1',
      ownerId: 'owner-1',
      property: { status: 'approved' }
    }),
    { ok: true }
  );

  assert.equal(
    validatePropertyDelete({
      actorUid: 'other-user',
      ownerId: 'owner-1',
      property: { status: 'approved' }
    }).status,
    403
  );
});

test('Missing identity rejected', () => {
  assert.equal(
    validatePropertyDelete({
      actorUid: '',
      ownerId: 'owner-1',
      property: { status: 'pending' }
    }).status,
    401
  );
});

test('Pending, approved and rejected properties may be deleted', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    assert.equal(
      validatePropertyDelete({
        actorUid: 'owner-1',
        ownerId: 'owner-1',
        property: { status }
      }).ok,
      true
    );
  }
});

test('Sold and unsupported statuses rejected', () => {
  for (const status of ['sold', 'expired', 'deleting', '']) {
    assert.equal(
      validatePropertyDelete({
        actorUid: 'owner-1',
        ownerId: 'owner-1',
        property: { status }
      }).status,
      409
    );
  }
});

test('Existing deletion workflow cannot be started again', () => {
  for (const deletionState of ['pending', 'deleting']) {
    assert.equal(
      validatePropertyDelete({
        actorUid: 'owner-1',
        ownerId: 'owner-1',
        property: { status: 'approved', deletionState }
      }).status,
      409
    );
  }
});

console.log('All property-delete policy tests passed.');
