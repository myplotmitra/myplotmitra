'use strict';

const { canUnlockContactFor } = require('./_property-policy');

function resolveOwnerId(publicData, privateData, privateExists) {
  if (privateExists) {
    return typeof privateData?.ownerId === 'string'
      ? privateData.ownerId.trim()
      : '';
  }
  return typeof publicData?.ownerId === 'string'
    ? publicData.ownerId.trim()
    : '';
}

function canReadSellerContact({
  publicData,
  privateData,
  privateExists = false,
  buyerUid,
  propertyId,
  unlockRecord,
}) {
  const ownerId = resolveOwnerId(publicData, privateData, privateExists);
  // The listing's public moderation status is authoritative. Only the owner
  // identifier is resolved from the private owner record.
  const property = { ...(publicData || {}), ownerId };

  if (!canUnlockContactFor(property, buyerUid)) return false;
  if (!unlockRecord || typeof unlockRecord !== 'object') return false;
  return String(unlockRecord.buyerId || '') === String(buyerUid || '') &&
    typeof propertyId === 'string' &&
    propertyId.length > 0 &&
    String(unlockRecord.propertyId || '') === propertyId;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function hasActivePremium(userData, nowMs = Date.now()) {
  return timestampMillis(userData && userData.premiumUntil) > nowMs;
}

function hasApprovedContactRequest(requestData, { propertyId, buyerUid, ownerId }) {
  if (!requestData || typeof requestData !== 'object') return false;
  return requestData.status === 'approved' &&
    String(requestData.propertyId || '') === String(propertyId || '') &&
    String(requestData.buyerId || '') === String(buyerUid || '') &&
    String(requestData.sellerId || '') === String(ownerId || '');
}

function normalizeIndianPhone(value) {
  if (typeof value !== 'string') return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits) ? digits : '';
}

module.exports = {
  resolveOwnerId,
  canReadSellerContact,
  hasActivePremium,
  hasApprovedContactRequest,
  normalizeIndianPhone,
};
