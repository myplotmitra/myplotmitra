'use strict';

// A buyer may unlock seller contact only for an approved or sold listing
// owned by someone else. Shared by paid and credit-based unlocks.
function canUnlockContactFor(property, buyerUid) {
  if (!property || typeof property !== 'object') return false;
  if (typeof buyerUid !== 'string' || !buyerUid.trim()) return false;
  const ownerId = typeof property.ownerId === 'string' ? property.ownerId.trim() : '';
  if (!ownerId || ownerId === buyerUid) return false;
  return ['approved', 'sold'].includes(property.status);
}
module.exports = { canUnlockContactFor };
