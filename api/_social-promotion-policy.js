'use strict';

const SOCIAL_PROMOTION_PRICE_PER_PLATFORM = 500;
const SOCIAL_PROMOTION_PLATFORMS = Object.freeze(['youtube', 'facebook', 'instagram']);

const SOCIAL_HOSTS = Object.freeze({
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']),
  facebook: new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch']),
  instagram: new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
});

function normalizeRequestedPlatforms(value) {
  if (!Array.isArray(value)) return [];
  const values = value.map(item => String(item || '').trim().toLowerCase());
  if (values.some(item => !SOCIAL_PROMOTION_PLATFORMS.includes(item))) {
    throw new Error('INVALID_SOCIAL_PROMOTION_PLATFORM');
  }
  if (new Set(values).size !== values.length) {
    throw new Error('DUPLICATE_SOCIAL_PROMOTION_PLATFORM');
  }
  return values;
}

function calculateSocialPromotionAmount(platforms) {
  const normalized = normalizeRequestedPlatforms(platforms);
  if (!normalized.length) throw new Error('NO_SOCIAL_PROMOTION_PLATFORMS');
  return normalized.length * SOCIAL_PROMOTION_PRICE_PER_PLATFORM;
}

function normalizePublishedSocialUrl(platform, value) {
  const key = String(platform || '').trim().toLowerCase();
  if (!SOCIAL_PROMOTION_PLATFORMS.includes(key)) {
    throw new Error('INVALID_SOCIAL_PROMOTION_PLATFORM');
  }
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('INVALID_SOCIAL_PROMOTION_URL');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('INVALID_SOCIAL_PROMOTION_URL');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !SOCIAL_HOSTS[key].has(parsed.hostname.toLowerCase())
  ) {
    throw new Error('SOCIAL_PROMOTION_URL_HOST_MISMATCH');
  }

  return parsed.toString();
}


function isVerifiedSocialPromotionPayment({
  payment,
  propertyId,
  ownerId,
  platform,
  paymentOrderId
}) {
  const source = payment && typeof payment === 'object' ? payment : {};
  let platforms;
  try {
    platforms = normalizeRequestedPlatforms(source.socialPromotionPlatforms || []);
  } catch (_) {
    return false;
  }
  const key = String(platform || '').trim().toLowerCase();
  const orderId = String(paymentOrderId || '').trim();
  const storedOrderId = String(source.orderId || '').trim();
  const storedPropertyId = String(source.propId || '').trim();
  const storedOwnerId = String(source.uid || '').trim();
  const unitPrice = Number(source.socialPromotionUnitPrice);
  const amount = Number(source.amount);

  return Boolean(
    key && SOCIAL_PROMOTION_PLATFORMS.includes(key) &&
    orderId && storedOrderId === orderId &&
    source.gateway === 'cashfree' &&
    source.kind === 'social_promotion' &&
    source.status === 'success' &&
    source.paymentStatus === 'paid' &&
    source.fulfilmentStatus === 'complete' &&
    String(source.cfPaymentId || '').trim() &&
    storedPropertyId === String(propertyId || '').trim() &&
    storedOwnerId === String(ownerId || '').trim() &&
    platforms.includes(key) &&
    Number.isSafeInteger(unitPrice) &&
    unitPrice === SOCIAL_PROMOTION_PRICE_PER_PLATFORM &&
    Number.isSafeInteger(amount) &&
    amount === platforms.length * SOCIAL_PROMOTION_PRICE_PER_PLATFORM
  );
}

function getUnpaidSocialPromotionPlatforms(property) {
  const source = property || {};
  const requested = normalizeRequestedPlatforms(source.socialPromotionPlatforms || []);
  const promotions = source.socialPromotions && typeof source.socialPromotions === 'object'
    ? source.socialPromotions
    : {};
  return requested.filter(platform => {
    const item = promotions[platform] && typeof promotions[platform] === 'object'
      ? promotions[platform]
      : {};
    return item.paymentStatus !== 'paid' && item.published !== true;
  });
}

module.exports = {
  SOCIAL_PROMOTION_PRICE_PER_PLATFORM,
  SOCIAL_PROMOTION_PLATFORMS,
  normalizeRequestedPlatforms,
  calculateSocialPromotionAmount,
  normalizePublishedSocialUrl,
  isVerifiedSocialPromotionPayment,
  getUnpaidSocialPromotionPlatforms
};
