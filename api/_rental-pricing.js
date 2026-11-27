'use strict';

const SOCIAL_PROMOTION_PRICE_PER_PLATFORM = 500;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function calculateRentalDraftPricing({
  settings = {},
  photoCount,
  featuredRequested = false,
  socialPromotionPlatforms = []
}) {
  if (!Number.isSafeInteger(photoCount) || photoCount < 1 || photoCount > 100) {
    fail('INVALID_RENTAL_PHOTO_COUNT', 400);
  }
  if (!Array.isArray(socialPromotionPlatforms) || socialPromotionPlatforms.some(
    platform => !['youtube', 'facebook', 'instagram'].includes(platform)
  ) || new Set(socialPromotionPlatforms).size !== socialPromotionPlatforms.length) {
    fail('INVALID_RENTAL_SOCIAL_PROMOTIONS', 400);
  }

  const onePhotoFreeEnabled = settings.rentalOnePhotoFreeEnabled !== false;
  const basePrice = settings.rentalBasePrice == null ? 20 : settings.rentalBasePrice;
  const includedPhotos = settings.rentalIncludedPhotos == null ? 3 : settings.rentalIncludedPhotos;
  const extraPhotoPrice = settings.rentalExtraPhotoPrice == null ? 10 : settings.rentalExtraPhotoPrice;
  const configuredFeaturedPrice = settings.featuredPrice == null ? 499 : settings.featuredPrice;
  const featuredPrice = Number.isSafeInteger(configuredFeaturedPrice) && configuredFeaturedPrice > 0
    ? configuredFeaturedPrice
    : 499;

  if (
    !Number.isSafeInteger(basePrice) || basePrice < 1 ||
    !Number.isSafeInteger(includedPhotos) || includedPhotos < 1 ||
    !Number.isSafeInteger(extraPhotoPrice) || extraPhotoPrice < 0
  ) {
    fail('INVALID_RENTAL_PRICING_SETTINGS', 500);
  }

  const isFreeOnePhoto = onePhotoFreeEnabled && photoCount === 1;
  const extraPhotoCount = isFreeOnePhoto ? 0 : Math.max(0, photoCount - includedPhotos);
  const photoFee = isFreeOnePhoto ? 0 : basePrice + (extraPhotoCount * extraPhotoPrice);
  const featuredFee = featuredRequested ? featuredPrice : 0;
  const socialPromotionPrice = SOCIAL_PROMOTION_PRICE_PER_PLATFORM;
  const socialPromotionFee = socialPromotionPlatforms.length * socialPromotionPrice;
  const amount = photoFee + featuredFee + socialPromotionFee;

  if (photoFee > 0 && settings.rentalPaymentEnabled !== true) {
    fail('RENTAL_PHOTO_PAYMENT_DISABLED', 409);
  }
  if (!Number.isSafeInteger(amount) || amount < 1) {
    fail('INVALID_RENTAL_CHECKOUT_AMOUNT', 500);
  }

  return {
    amount,
    pricingSnapshot: {
      photoCount,
      basePrice,
      includedPhotos,
      extraPhotoPrice,
      extraPhotoCount,
      photoFee,
      featuredRequested: featuredRequested === true,
      featuredFee,
      featuredPrice,
      socialPromotionPlatforms: [...socialPromotionPlatforms],
      socialPromotionPrice,
      socialPromotionFee,
      onePhotoFreeEnabled,
      amount,
      currency: 'INR'
    }
  };
}

module.exports = { calculateRentalDraftPricing, SOCIAL_PROMOTION_PRICE_PER_PLATFORM };
