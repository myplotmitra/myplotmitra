'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashfreeFulfilmentResult } = require('../api/_cashfree-fulfilment-result');

test('rental fulfilment returns the newly published property ID', () => {
  const result = buildCashfreeFulfilmentResult(
    { kind: 'rental', propId: null, propertyId: 'property-123' },
    { propId: 'property-123', propertyId: 'property-123' }
  );
  assert.equal(result.success, true);
  assert.equal(result.kind, 'rental');
  assert.equal(result.propId, 'property-123');
  assert.equal(result.propertyId, 'property-123');
  assert.equal(result.needsReview, false);
});

test('fulfilment update wins over the original order property reference', () => {
  const result = buildCashfreeFulfilmentResult(
    { kind: 'rental', propId: null },
    { propertyId: 'new-property-id' }
  );
  assert.equal(result.propId, 'new-property-id');
});

test('non-rental payments retain their original property reference', () => {
  const result = buildCashfreeFulfilmentResult(
    { kind: 'property_addons', propId: 'existing-property-id' },
    {}
  );
  assert.equal(result.propId, 'existing-property-id');
  assert.equal(result.propertyId, 'existing-property-id');
});

test('fulfilment needing manual review is flagged', () => {
  const result = buildCashfreeFulfilmentResult(
    { kind: 'rental' },
    { propertyId: 'property-123', fulfilmentStatus: 'needs_review' }
  );
  assert.equal(result.needsReview, true);
});
