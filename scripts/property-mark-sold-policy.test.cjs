'use strict';

const assert = require('node:assert/strict');

const {
  normalizeMarkSoldRequest,
  resolveOwnerId,
  validateMarkSold,
} = require('../api/_property-mark-sold-policy');

function expectStatus(fn, status) {
  assert.throws(fn, error => error.status === status);
}

// Valid request.
assert.deepEqual(
  normalizeMarkSoldRequest({ propertyId: 'preview_test_123' }),
  { propertyId: 'preview_test_123' }
);

// Invalid request shapes and protected fields.
expectStatus(() => normalizeMarkSoldRequest(null), 400);
expectStatus(() => normalizeMarkSoldRequest({ propertyId: 'bad/id' }), 400);
expectStatus(() => normalizeMarkSoldRequest({
  propertyId: 'preview_test_123',
  status: 'sold',
}), 400);

// A private record is authoritative, including when its owner is missing.
assert.equal(
  resolveOwnerId(
    { ownerId: 'public-owner' },
    { ownerId: 'private-owner' },
    true
  ),
  'private-owner'
);
assert.equal(
  resolveOwnerId(
    { ownerId: 'public-owner' },
    {},
    true
  ),
  ''
);

// Legacy listings without a private record use the public owner ID.
assert.equal(
  resolveOwnerId({ ownerId: 'legacy-owner' }, null, false),
  'legacy-owner'
);

// Owner and status validation.
assert.doesNotThrow(() => validateMarkSold({
  property: { status: 'approved' },
  ownerId: 'owner-1',
  actorUid: 'owner-1',
}));

expectStatus(() => validateMarkSold({
  property: { status: 'approved' },
  ownerId: 'owner-2',
  actorUid: 'owner-1',
}), 403);

expectStatus(() => validateMarkSold({
  property: { status: 'pending' },
  ownerId: 'owner-1',
  actorUid: 'owner-1',
}), 409);

expectStatus(() => validateMarkSold({
  property: { status: 'approved', deletionState: 'deleting' },
  ownerId: 'owner-1',
  actorUid: 'owner-1',
}), 409);

expectStatus(() => validateMarkSold({
  property: { status: 'approved', deletionState: 'pending' },
  ownerId: 'owner-1',
  actorUid: 'owner-1',
}), 409);

expectStatus(() => validateMarkSold({
  property: { status: 'approved' },
  ownerId: 'owner-1',
  actorUid: '',
}), 401);

expectStatus(() => validateMarkSold({
  property: { status: 'approved', deletionState: 'error' },
  ownerId: 'owner-1',
  actorUid: 'owner-1',
}), 409);

console.log('PASS: Valid Mark as Sold request');
console.log('PASS: Invalid request and protected fields rejected');
console.log('PASS: Private owner record is authoritative');
console.log('PASS: Legacy owner fallback works');
console.log('PASS: Non-owners rejected');
console.log('PASS: Non-approved and deletion-workflow listings rejected');
