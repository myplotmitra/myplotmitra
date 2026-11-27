'use strict';

const assert = require('node:assert/strict');

const {
  parseOpaquePropertyImageKey,
  propertyUploadDocumentId,
  timestampMillis,
  isReadyUnassignedPropertyUpload,
  isAttachedPropertyUpload,
  isHeldPropertyUpload
} = require('../api/_property-upload-registry');

const owner = 'seller-uid-123';
const otherOwner = 'another-seller';
const propertyId = 'property-123';
const uuid = '550e8400-e29b-41d4-a716-446655440000';
const key = `properties/${uuid}.jpg`;
const now = 1800000000000;

function readyUpload(overrides = {}) {
  return {
    ownerId: owner,
    key,
    status: 'ready',
    propertyId: null,
    expiresAt: new Date(now + 60000),
    ...overrides
  };
}

const cases = [
  ['accepts opaque JPEG key', key, true],
  ['accepts opaque PNG key', `properties/${uuid}.png`, true],
  ['accepts opaque WebP key', `properties/${uuid}.webp`, true],
  ['rejects legacy UID-prefixed key', `properties/${owner}/${uuid}.jpg`, false],
  ['rejects extra path segment', `properties/extra/${uuid}.jpg`, false],
  ['rejects malformed UUID', 'properties/not-a-uuid.jpg', false],
  ['rejects non-v4 UUID', 'properties/550e8400-e29b-11d4-a716-446655440000.jpg', false],
  ['rejects unsupported extension', `properties/${uuid}.gif`, false],
  ['rejects traversal-like path', `properties/../${uuid}.jpg`, false],
  ['rejects non-string key', 42, false]
];

let passed = 0;

for (const [name, candidate, expected] of cases) {
  assert.equal(!!parseOpaquePropertyImageKey(candidate), expected, name);
  console.log(`PASS: ${name}`);
  passed++;
}

assert.equal(propertyUploadDocumentId(key), uuid);
assert.equal(propertyUploadDocumentId('legacy/key.jpg'), null);
console.log('PASS: derives registry ID only from a valid opaque key');
passed++;

assert.equal(timestampMillis(new Date(now)), now);
assert.equal(timestampMillis({ toMillis: () => now }), now);
assert.equal(timestampMillis('invalid'), NaN);
console.log('PASS: safely reads supported expiry timestamp values');
passed++;

assert.equal(
  isReadyUnassignedPropertyUpload(readyUpload(), owner, key, now),
  true
);
console.log('PASS: accepts ready, unassigned upload owned by seller');
passed++;

const rejectedReadyCases = [
  ['rejects another owner', readyUpload({ ownerId: otherOwner }), owner, key],
  ['rejects mismatched key', readyUpload({ key: `properties/${uuid}.png` }), owner, key],
  ['rejects unfinalized upload', readyUpload({ status: 'reserved' }), owner, key],
  ['rejects already attached upload', readyUpload({ status: 'attached', propertyId }), owner, key],
  ['rejects expired upload', readyUpload({ expiresAt: new Date(now) }), owner, key],
  ['rejects missing expiry', readyUpload({ expiresAt: undefined }), owner, key]
];

for (const [name, upload, uid, candidate] of rejectedReadyCases) {
  assert.equal(isReadyUnassignedPropertyUpload(upload, uid, candidate, now), false, name);
  console.log(`PASS: ${name}`);
  passed++;
}

assert.equal(
  isAttachedPropertyUpload(
    { ownerId: owner, key, status: 'attached', propertyId },
    owner,
    propertyId,
    key
  ),
  true
);
console.log('PASS: accepts key attached to the matching owner and property');
passed++;

const rejectedAttachedCases = [
  ['rejects different owner', { ownerId: otherOwner, key, status: 'attached', propertyId }, owner, propertyId, key],
  ['rejects different property', { ownerId: owner, key, status: 'attached', propertyId: 'other-property' }, owner, propertyId, key],
  ['rejects unassigned upload', readyUpload(), owner, propertyId, key],
  ['rejects mismatched key', { ownerId: owner, key: `properties/${uuid}.png`, status: 'attached', propertyId }, owner, propertyId, key]
];

for (const [name, upload, uid, pid, candidate] of rejectedAttachedCases) {
  assert.equal(isAttachedPropertyUpload(upload, uid, pid, candidate), false, name);
  console.log(`PASS: ${name}`);
  passed++;
}

const {
  isCleanupEligiblePropertyUpload
} = require('../api/_property-upload-registry');

assert.equal(
  isCleanupEligiblePropertyUpload(readyUpload(), owner, key),
  true
);
console.log('PASS: cleanup accepts an unassigned ready upload');
passed++;

assert.equal(
  isCleanupEligiblePropertyUpload(
    readyUpload({ status: 'attached', propertyId }),
    owner,
    key
  ),
  false
);
console.log('PASS: cleanup refuses an attached upload');
passed++;

assert.equal(
  isCleanupEligiblePropertyUpload(
    readyUpload({ status: 'deleting' }),
    owner,
    key
  ),
  false
);
console.log('PASS: cleanup refuses an upload already being deleted');
passed++;

assert.equal(
  isCleanupEligiblePropertyUpload(
    readyUpload({ ownerId: otherOwner }),
    owner,
    key
  ),
  false
);
console.log('PASS: cleanup refuses another owner upload');
passed++;


const heldUpload = {
  ownerId: owner,
  key,
  status: 'held',
  rentalDraftId: 'rental-draft-123',
  propertyId: null
};

assert.equal(
  isHeldPropertyUpload(heldUpload, owner, key, 'rental-draft-123'),
  true
);
console.log('PASS: accepts held upload for matching owner and draft');
passed++;

assert.equal(
  isHeldPropertyUpload(heldUpload, otherOwner, key, 'rental-draft-123'),
  false
);
console.log('PASS: held upload rejects another owner');
passed++;

assert.equal(
  isHeldPropertyUpload(heldUpload, owner, key, 'different-draft'),
  false
);
console.log('PASS: held upload rejects another draft');
passed++;

assert.equal(
  isHeldPropertyUpload(heldUpload, owner, 'properties/invalid.jpg', 'rental-draft-123'),
  false
);
console.log('PASS: held upload rejects mismatched key');
passed++;

assert.equal(
  isCleanupEligiblePropertyUpload(heldUpload, owner, key),
  false
);
console.log('PASS: cleanup refuses a held rental upload');
passed++;

console.log(`\nPassed: ${passed}`);
console.log('Failed: 0');
