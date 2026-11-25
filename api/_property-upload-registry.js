'use strict';

const OPAQUE_PROPERTY_KEY =
  /^properties\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp)$/i;

function parseOpaquePropertyImageKey(key) {
  if (typeof key !== 'string') return null;

  const match = OPAQUE_PROPERTY_KEY.exec(key);
  if (!match) return null;

  return {
    uploadId: match[1].toLowerCase(),
    extension: match[2].toLowerCase()
  };
}

function propertyUploadDocumentId(key) {
  const parsed = parseOpaquePropertyImageKey(key);
  return parsed ? parsed.uploadId : null;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : NaN;
  }

  if (value instanceof Date) return value.getTime();

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return NaN;
}

function isReadyUnassignedPropertyUpload(
  upload,
  ownerUid,
  key,
  nowMs = Date.now()
) {
  const uploadId = propertyUploadDocumentId(key);
  if (!uploadId || !upload || typeof upload !== 'object') return false;

  const expiresAtMs = timestampMillis(upload.expiresAt);

  return (
    typeof ownerUid === 'string' &&
    ownerUid.length > 0 &&
    upload.ownerId === ownerUid &&
    upload.key === key &&
    upload.status === 'ready' &&
    !upload.propertyId &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > nowMs
  );
}

function isAttachedPropertyUpload(upload, ownerUid, propertyId, key) {
  const uploadId = propertyUploadDocumentId(key);
  if (!uploadId || !upload || typeof upload !== 'object') return false;

  return (
    typeof ownerUid === 'string' &&
    ownerUid.length > 0 &&
    typeof propertyId === 'string' &&
    propertyId.length > 0 &&
    upload.ownerId === ownerUid &&
    upload.key === key &&
    upload.status === 'attached' &&
    upload.propertyId === propertyId
  );
}

function isCleanupEligiblePropertyUpload(upload, ownerUid, key) {
  const uploadId = propertyUploadDocumentId(key);
  if (!uploadId || !upload || typeof upload !== 'object') return false;

  return (
    typeof ownerUid === 'string' &&
    ownerUid.length > 0 &&
    upload.ownerId === ownerUid &&
    upload.key === key &&
    ['reserved', 'ready'].includes(upload.status) &&
    !upload.propertyId
  );
}

function isHeldPropertyUpload(upload, ownerUid, key, rentalDraftId) {
  const uploadId = propertyUploadDocumentId(key);

  if (!uploadId || !upload || typeof upload !== 'object') {
    return false;
  }

  return (
    typeof ownerUid === 'string' &&
    ownerUid.length > 0 &&
    typeof rentalDraftId === 'string' &&
    rentalDraftId.length > 0 &&
    upload.ownerId === ownerUid &&
    upload.key === key &&
    upload.status === 'held' &&
    upload.rentalDraftId === rentalDraftId &&
    !upload.propertyId
  );
}

module.exports = {
  parseOpaquePropertyImageKey,
  propertyUploadDocumentId,
  timestampMillis,
  isReadyUnassignedPropertyUpload,
  isAttachedPropertyUpload,
  isCleanupEligiblePropertyUpload,
  isHeldPropertyUpload
};
