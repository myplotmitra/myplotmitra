'use strict';

const PRIVATE_FIELDS = [
  'ownerId',
  'ownerEmail',
  'ownerName',
  'sellerPhone',
  'ownerPhone',
  'waVerified',
  'paymentProofKey',
  'photoKeys',
  'coverPhotoKey'
];

const CONTACT_FIELDS = [
  'ownerName',
  'sellerPhone',
  'waVerified'
];

function mergePropertyData(publicData, privateData) {
  return {
    ...(publicData || {}),
    ...(privateData || {})
  };
}

function getPropertyOwnerId(publicData, privateData) {
  const merged = mergePropertyData(publicData, privateData);
  return typeof merged.ownerId === 'string'
    ? merged.ownerId.trim()
    : '';
}

function collectPropertyPhotoKeys(publicData, privateData) {
  const property = mergePropertyData(publicData, privateData);

  if (property.photoKeys != null && !Array.isArray(property.photoKeys)) {
    throw new Error('INVALID_PHOTO_KEYS_FIELD');
  }

  const keys = property.photoKeys ? [...property.photoKeys] : [];

  if (
    property.coverPhotoKey != null &&
    property.coverPhotoKey !== ''
  ) {
    keys.push(property.coverPhotoKey);
  }

  if (keys.some(key => typeof key !== 'string' || !key.trim())) {
    throw new Error('INVALID_PROPERTY_IMAGE_KEY');
  }

  return [...new Set(keys)];
}

function buildPrivatePropertyData(publicData, existingPrivate) {
  const source = publicData || {};
  const existing = existingPrivate || {};
  const moved = {};

  for (const field of PRIVATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      moved[field] = source[field];
    }
  }

  // Older public records used ownerPhone. Normalize it to the canonical
  // sellerPhone contact field before it is removed from the public document.
  if (!String(moved.sellerPhone || '').trim() &&
      String(moved.ownerPhone || '').trim()) {
    moved.sellerPhone = moved.ownerPhone;
  }

  const oldOwner = String(moved.ownerId || '').trim();
  const storedOwner = String(existing.ownerId || '').trim();

  if (oldOwner && storedOwner && oldOwner !== storedOwner) {
    throw new Error('PROPERTY_OWNER_CONFLICT');
  }

  const merged = { ...moved, ...existing };

  if (!String(merged.ownerId || '').trim()) {
    throw new Error('MISSING_PROPERTY_OWNER');
  }

  // Historical values came from a client-side flag, not trusted verification.
  merged.waVerified = false;

  return merged;
}

function buildPropertyContactInfo(privateData) {
  const source = privateData || {};
  const result = {};

  for (const field of CONTACT_FIELDS) {
    if (field === 'waVerified') continue;

    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  }

  // Never expose a historical browser-supplied verification claim.
  result.waVerified = false;

  return result;
}

module.exports = {
  PRIVATE_FIELDS,
  CONTACT_FIELDS,
  mergePropertyData,
  getPropertyOwnerId,
  collectPropertyPhotoKeys,
  buildPrivatePropertyData,
  buildPropertyContactInfo
};
