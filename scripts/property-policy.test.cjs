'use strict';
const assert = require('node:assert/strict');
const { canUnlockContactFor } = require('../api/_property-policy');

const cases = [
  ['approved listing owned by another user', { ownerId: 'seller-1', status: 'approved' }, 'buyer-1', true],
  ['sold listing owned by another user', { ownerId: 'seller-1', status: 'sold' }, 'buyer-1', true],
  ['pending listing', { ownerId: 'seller-1', status: 'pending' }, 'buyer-1', false],
  ['rejected listing', { ownerId: 'seller-1', status: 'rejected' }, 'buyer-1', false],
  ['draft listing', { ownerId: 'seller-1', status: 'draft' }, 'buyer-1', false],
  ['missing property', null, 'buyer-1', false],
  ['buyer is owner', { ownerId: 'buyer-1', status: 'approved' }, 'buyer-1', false],
  ['missing owner', { status: 'approved' }, 'buyer-1', false],
  ['missing buyer UID', { ownerId: 'seller-1', status: 'approved' }, '', false],
];

let failed = 0;
for (const [name, property, buyerUid, expected] of cases) {
  try {
    assert.equal(canUnlockContactFor(property, buyerUid), expected);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}
console.log(`Passed: ${cases.length - failed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${cases.length}`);
if (failed) process.exitCode = 1;
