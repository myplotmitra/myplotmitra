'use strict';

const assert = require('node:assert/strict');

const {
  normalizePropertyUpdateRequest,
  validateMergedProperty
} = require('../api/_property-update-policy');

const validBody = {
  propertyId: 'preview-test-owner-listing-001',
  changes: {
    title: 'Updated Preview Plot',
    price: 900000,
    description: 'Updated test description'
  }
};

const normalized = normalizePropertyUpdateRequest(validBody);

assert.equal(normalized.propertyId, validBody.propertyId);
assert.equal(normalized.patch.title, 'Updated Preview Plot');
assert.equal(normalized.patch.price, 900000);

const mergedPatch = { ...normalized.patch };

validateMergedProperty({
  title: 'Old title',
  address: 'Neelampalli Road',
  type: 'plot',
  transactionType: 'sale',
  price: 850000,
  status: 'pending'
}, mergedPatch);

assert.equal(mergedPatch.price, 900000);

for (const protectedField of [
  'ownerId',
  'sellerPhone',
  'status',
  'isFeatured',
  'photoKeys',
  'coverPhoto',
  'badges',
  'transactionType',
  'rentPeriod'
]) {
  assert.throws(() => normalizePropertyUpdateRequest({
    propertyId: 'preview-test-owner-listing-001',
    changes: { [protectedField]: 'attacker-controlled-value' }
  }));
}

assert.throws(() => normalizePropertyUpdateRequest({
  propertyId: '../invalid',
  changes: { title: 'Invalid' }
}));

assert.throws(() => normalizePropertyUpdateRequest({
  propertyId: 'test-1',
  changes: { price: -100 }
}));

assert.throws(() => normalizePropertyUpdateRequest({
  propertyId: 'test-1',
  changes: { lat: 15.0 }
}));

console.log('PASS: Valid property update');
console.log('PASS: Protected fields rejected');
console.log('PASS: Invalid property ID rejected');
console.log('PASS: Invalid price rejected');
console.log('PASS: Incomplete map coordinates rejected');
