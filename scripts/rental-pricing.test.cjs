'use strict';

const assert = require('node:assert/strict');
const { calculateRentalDraftPricing } = require('../api/_rental-pricing');

const enabled = {
  rentalPaymentEnabled: true,
  rentalOnePhotoFreeEnabled: true,
  rentalBasePrice: 20,
  rentalIncludedPhotos: 3,
  rentalExtraPhotoPrice: 10,
  featuredPrice: 499
};

let result = calculateRentalDraftPricing({ settings: enabled, photoCount: 3 });
assert.equal(result.amount, 20);
assert.equal(result.pricingSnapshot.includedPhotos, 3);
console.log('PASS: default rental base fee covers the configured included-photo allowance');

result = calculateRentalDraftPricing({ settings: enabled, photoCount: 4 });
assert.equal(result.amount, 30);
assert.equal(result.pricingSnapshot.photoFee, 30);
assert.equal(result.pricingSnapshot.extraPhotoCount, 1);
console.log('PASS: rental photo fee adds the configured extra-photo amount');

result = calculateRentalDraftPricing({
  settings: enabled,
  photoCount: 1,
  featuredRequested: true,
  socialPromotionPlatforms: ['youtube', 'instagram']
});
assert.equal(result.pricingSnapshot.photoFee, 0);
assert.equal(result.pricingSnapshot.featuredFee, 499);
assert.equal(result.pricingSnapshot.socialPromotionFee, 1000);
assert.equal(result.amount, 1499);
console.log('PASS: one free rental photo can be combined with Featured and social paid add-ons');

result = calculateRentalDraftPricing({
  settings: enabled,
  photoCount: 3,
  featuredRequested: true,
  socialPromotionPlatforms: ['facebook']
});
assert.equal(result.amount, 1019);
console.log('PASS: rental total combines photo, Featured and per-platform pricing');

assert.throws(
  () => calculateRentalDraftPricing({
    settings: { ...enabled, rentalPaymentEnabled: false },
    photoCount: 2
  }),
  /RENTAL_PHOTO_PAYMENT_DISABLED/
);
console.log('PASS: server blocks paid rental photos when the admin switch is disabled');

result = calculateRentalDraftPricing({
  settings: { ...enabled, rentalPaymentEnabled: false },
  photoCount: 1,
  featuredRequested: true
});
assert.equal(result.amount, 499);
console.log('PASS: disabled rental photo fee does not block a separately paid Featured option');

assert.throws(
  () => calculateRentalDraftPricing({ settings: enabled, photoCount: 0 }),
  /INVALID_RENTAL_PHOTO_COUNT/
);
assert.throws(
  () => calculateRentalDraftPricing({ settings: enabled, photoCount: 2, socialPromotionPlatforms: ['tiktok'] }),
  /INVALID_RENTAL_SOCIAL_PROMOTIONS/
);
console.log('PASS: invalid photo counts and social platforms are rejected');

result = calculateRentalDraftPricing({
  settings: { ...enabled, featuredPrice: 0 },
  photoCount: 1,
  featuredRequested: true
});
assert.equal(result.pricingSnapshot.featuredPrice, 499);
assert.equal(result.amount, 499);
console.log('PASS: invalid zero Featured setting uses the same ₹499 fallback as the posting-price endpoint');
