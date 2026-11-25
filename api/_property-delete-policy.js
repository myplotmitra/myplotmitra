'use strict';

const PROPERTY_ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/;

function normalizeDeleteRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'propertyId') return null;

  if (
    typeof body.propertyId !== 'string' ||
    !PROPERTY_ID_PATTERN.test(body.propertyId)
  ) {
    return null;
  }

  return { propertyId: body.propertyId };
}

function resolveOwnerId(publicData, privateData, privateExists) {
  const source = privateExists ? privateData : publicData;
  const ownerId = source && typeof source.ownerId === 'string'
    ? source.ownerId.trim()
    : '';

  return ownerId;
}

function validatePropertyDelete({ actorUid, ownerId, property }) {
  if (typeof actorUid !== 'string' || !actorUid.trim()) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    return { ok: false, status: 409, error: 'Property owner information is missing' };
  }

  if (actorUid !== ownerId) {
    return { ok: false, status: 403, error: 'You cannot delete this property' };
  }

  const status = String(property?.status || '').trim().toLowerCase();

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return { ok: false, status: 409, error: 'This property cannot be deleted in its current status' };
  }

  const deletionState = String(property?.deletionState || '').trim().toLowerCase();

  if (['pending', 'deleting'].includes(deletionState)) {
    return { ok: false, status: 409, error: 'Property deletion is already in progress' };
  }

  return { ok: true };
}

module.exports = {
  normalizeDeleteRequest,
  resolveOwnerId,
  validatePropertyDelete
};
