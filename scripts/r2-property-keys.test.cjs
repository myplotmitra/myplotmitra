'use strict';

const assert = require('node:assert/strict');
const { isValidPropertyImageKey } = require('../api/_r2-property-keys');

const owner = 'firebaseUser_123-ABC';
const uuid = '550e8400-e29b-41d4-a716-446655440000';

const cases = [
  ['accepts owner JPEG key', `properties/${owner}/${uuid}.jpg`, owner, true],
  ['accepts owner PNG key', `properties/${owner}/${uuid}.png`, owner, true],
  ['accepts owner WebP key', `properties/${owner}/${uuid}.webp`, owner, true],
  ['rejects another owner', `properties/other/${uuid}.jpg`, owner, false],
  ['rejects extra path segment', `properties/${owner}/extra/${uuid}.jpg`, owner, false],
  ['rejects traversal-like filename', `properties/${owner}/../${uuid}.jpg`, owner, false],
  ['rejects unsupported extension', `properties/${owner}/${uuid}.gif`, owner, false],
  ['rejects malformed UUID', `properties/${owner}/not-a-uuid.jpg`, owner, false],
  ['rejects non-v4 UUID', `properties/${owner}/550e8400-e29b-11d4-a716-446655440000.jpg`, owner, false],
  ['rejects empty key', '', owner, false],
  ['rejects non-string key', 42, owner, false],
  ['rejects empty owner', `properties/${owner}/${uuid}.jpg`, '', false],
  ['rejects owner path separator', `properties/${owner}/${uuid}.jpg`, 'owner/other', false],
];

let passed = 0;
for (const [name, key, uid, expected] of cases) {
  assert.equal(isValidPropertyImageKey(key, uid), expected, name);
  console.log(`PASS: ${name}`);
  passed += 1;
}
console.log(`\nPassed: ${passed}\nFailed: 0\nTotal: ${cases.length}`);
