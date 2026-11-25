'use strict';

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizeMarkSoldRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Invalid request');
  }

  for (const key of Object.keys(body)) {
    if (key !== 'propertyId') {
      fail(400, 'Invalid request field');
    }
  }

  const propertyId =
    typeof body.propertyId === 'string' ? body.propertyId.trim() : '';

  if (!/^[A-Za-z0-9_-]{1,150}$/.test(propertyId)) {
    fail(400, 'Valid property ID required');
  }

  return { propertyId };
}

function resolveOwnerId(publicData, privateData, privateExists) {
  const source = privateExists ? (privateData || {}) : (publicData || {});
  return typeof source.ownerId === 'string' ? source.ownerId.trim() : '';
}

function validateMarkSold({ property, ownerId, actorUid }) {
  if (!actorUid) {
    fail(401, 'Please sign in again');
  }

  if (!ownerId || ownerId !== actorUid) {
    fail(403, 'You can only mark your own property as sold');
  }

  if (!property || property.status !== 'approved') {
    fail(409, 'Only approved listings can be marked as sold');
  }

  if (['pending', 'deleting', 'error'].includes(
    String(property.deletionState || '')
  )) {
    fail(409, 'This property is already in a deletion workflow');
  }
}

module.exports = {
  normalizeMarkSoldRequest,
  resolveOwnerId,
  validateMarkSold,
};
