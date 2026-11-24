'use strict';

const PRIVATE_FIELDS = new Set([
  'ownerId',
  'ownerEmail',
  'ownerName',
  'sellerPhone',
  'waVerified',
  'paymentProofKey',
  'photoKeys',
  'coverPhotoKey'
]);

function buildMyPropertyData(propertyId, publicData, privateData, uid) {
  const pub = publicData || {};
  const priv = privateData || {};

  // A present private record is authoritative, even if its owner is missing.
  const privateExists = privateData !== null && privateData !== undefined;

  if (privateExists) {
    if (String(priv.ownerId || '') !== uid) return null;
  } else if (String(pub.ownerId || '') !== uid) {
    return null;
  }

  const safe = {};
  for (const [key, value] of Object.entries(pub)) {
    if (!PRIVATE_FIELDS.has(key)) safe[key] = value;
  }

  return { ...safe, id: String(propertyId) };
}

module.exports = { buildMyPropertyData };
