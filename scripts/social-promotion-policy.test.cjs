'use strict';
const assert = require('node:assert/strict');
const {
  SOCIAL_PROMOTION_PRICE_PER_PLATFORM,
  normalizeRequestedPlatforms,
  calculateSocialPromotionAmount,
  normalizePublishedSocialUrl,
  isVerifiedSocialPromotionPayment,
  getUnpaidSocialPromotionPlatforms
} = require('../api/_social-promotion-policy');

assert.equal(SOCIAL_PROMOTION_PRICE_PER_PLATFORM, 500);
assert.deepEqual(normalizeRequestedPlatforms(['YouTube', 'facebook']), ['youtube', 'facebook']);
assert.equal(calculateSocialPromotionAmount(['youtube']), 500);
assert.equal(calculateSocialPromotionAmount(['youtube', 'facebook', 'instagram']), 1500);
assert.deepEqual(getUnpaidSocialPromotionPlatforms({
  socialPromotionPlatforms: ['youtube', 'facebook', 'instagram'],
  socialPromotions: { youtube: { paymentStatus: 'paid' }, facebook: { published: true } }
}), ['instagram']);
assert.equal(normalizePublishedSocialUrl('youtube', 'https://youtu.be/abc123'), 'https://youtu.be/abc123');
assert.equal(normalizePublishedSocialUrl('facebook', 'https://www.facebook.com/watch?v=123'), 'https://www.facebook.com/watch?v=123');
assert.equal(normalizePublishedSocialUrl('instagram', 'https://www.instagram.com/reel/abc/'), 'https://www.instagram.com/reel/abc/');
assert.throws(() => normalizeRequestedPlatforms(['youtube', 'youtube']), /DUPLICATE/);
assert.throws(() => normalizeRequestedPlatforms(['tiktok']), /INVALID/);
assert.throws(() => calculateSocialPromotionAmount([]), /NO_SOCIAL/);
assert.throws(() => normalizePublishedSocialUrl('youtube', 'http://youtube.com/watch?v=x'), /HOST_MISMATCH/);
assert.throws(() => normalizePublishedSocialUrl('youtube', 'https://evil.example/video'), /HOST_MISMATCH/);
assert.throws(() => normalizePublishedSocialUrl('facebook', 'https://youtube.com/watch?v=x'), /HOST_MISMATCH/);
console.log('Social promotion policy tests passed');


const verifiedPayment = {
  gateway: 'cashfree',
  kind: 'social_promotion',
  status: 'success',
  paymentStatus: 'paid',
  fulfilmentStatus: 'complete',
  cfPaymentId: 'cf-payment-123',
  orderId: 'MPM_SOCIAL_1',
  uid: 'owner-1',
  propId: 'property-1',
  socialPromotionPlatforms: ['youtube', 'facebook'],
  socialPromotionUnitPrice: 500,
  amount: 1000
};
const proofArgs = {
  payment: verifiedPayment,
  propertyId: 'property-1',
  ownerId: 'owner-1',
  platform: 'youtube',
  paymentOrderId: 'MPM_SOCIAL_1'
};
assert.equal(isVerifiedSocialPromotionPayment(proofArgs), true);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, ownerId: 'other-owner' }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, propertyId: 'other-property' }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, paymentOrderId: 'other-order' }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, platform: 'instagram' }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, payment: { ...verifiedPayment, fulfilmentStatus: 'needs_review' } }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, payment: { ...verifiedPayment, amount: 500 } }), false);
assert.equal(isVerifiedSocialPromotionPayment({ ...proofArgs, payment: { ...verifiedPayment, cfPaymentId: '' } }), false);
console.log('Social promotion verified payment proof tests passed');
