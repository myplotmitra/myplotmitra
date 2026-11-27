'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveOwnerId,
  canReadSellerContact,
  normalizeIndianPhone,
  hasActivePremium,
  hasApprovedContactRequest,
} = require('../api/_property-contact-policy');

const propertyId = 'property_123';
const publicData = { id: propertyId, status: 'approved', ownerId: 'seller_1' };
const validUnlock = {
  propertyId,
  buyerId: 'buyer_1',
  via: 'cashfree',
};

test('private owner record is authoritative over public fallback', () => {
  assert.equal(resolveOwnerId(publicData, { ownerId: 'seller_2' }, true), 'seller_2');
  assert.equal(resolveOwnerId(publicData, {}, true), '');
  assert.equal(resolveOwnerId(publicData, {}, false), 'seller_1');
});

test('seller contact requires approved/sold listing and valid buyer-specific unlock', () => {
  assert.equal(canReadSellerContact({
    publicData,
    privateData: { ownerId: 'seller_1' },
    privateExists: true,
    buyerUid: 'buyer_1',
    propertyId,
    unlockRecord: validUnlock,
  }), true);
});

test('seller contact is denied for own listings, pending listings and missing unlocks', () => {
  const base = {
    publicData,
    privateData: { ownerId: 'seller_1' },
    privateExists: true,
    buyerUid: 'buyer_1',
    propertyId,
    unlockRecord: validUnlock,
  };
  assert.equal(canReadSellerContact({ ...base, buyerUid: 'seller_1' }), false);
  assert.equal(canReadSellerContact({
    ...base,
    publicData: { ...publicData, status: 'pending' },
  }), false);
  assert.equal(canReadSellerContact({ ...base, unlockRecord: null }), false);
  assert.equal(canReadSellerContact({
    ...base,
    unlockRecord: { ...validUnlock, buyerId: 'another_buyer' },
  }), false);
  assert.equal(canReadSellerContact({
    ...base,
    unlockRecord: { ...validUnlock, propertyId: 'other_property' },
  }), false);
  assert.equal(canReadSellerContact({ ...base, propertyId: '' }), false);
});

test('sold listings remain contact-unlock eligible', () => {
  assert.equal(canReadSellerContact({
    publicData: { ...publicData, status: 'sold' },
    buyerUid: 'buyer_1',
    propertyId,
    unlockRecord: validUnlock,
  }), true);
});

test('Indian mobile number normalizer accepts 10-digit and +91 formats only', () => {
  assert.equal(normalizeIndianPhone('9876543210'), '9876543210');
  assert.equal(normalizeIndianPhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizeIndianPhone('09876543210'), '');
  assert.equal(normalizeIndianPhone('1234567890'), '');
  assert.equal(normalizeIndianPhone('not-a-number'), '');
  assert.equal(normalizeIndianPhone(9876543210), '');
});


test('Prime access uses the server-side expiry value', () => {
  const now = 1_900_000_000_000;
  assert.equal(hasActivePremium({ premiumUntil: new Date(now + 1000) }, now), true);
  assert.equal(hasActivePremium({ premiumUntil: new Date(now - 1000) }, now), false);
  assert.equal(hasActivePremium({}, now), false);
});

test('seller-approved phone requests are buyer/property/owner specific', () => {
  const approved = {
    status: 'approved',
    propertyId,
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
  };
  const ids = { propertyId, buyerUid: 'buyer_1', ownerId: 'seller_1' };
  assert.equal(hasApprovedContactRequest(approved, ids), true);
  assert.equal(hasApprovedContactRequest({ ...approved, status: 'pending' }, ids), false);
  assert.equal(hasApprovedContactRequest({ ...approved, buyerId: 'buyer_2' }, ids), false);
  assert.equal(hasApprovedContactRequest({ ...approved, propertyId: 'other' }, ids), false);
  assert.equal(hasApprovedContactRequest({ ...approved, sellerId: 'seller_2' }, ids), false);
});
