'use strict';

const assert = require('node:assert/strict');

const {
  mergePropertyData,
  getPropertyOwnerId,
  collectPropertyPhotoKeys,
  buildPrivatePropertyData,
  buildPropertyContactInfo
} = require('../api/_property-private');

const tests = [
  ['private owner takes precedence over legacy public owner', () => {
    assert.equal(
      getPropertyOwnerId(
        { ownerId: 'legacy-owner' },
        { ownerId: 'private-owner' }
      ),
      'private-owner'
    );
  }],

  ['legacy owner is supported before migration', () => {
    assert.equal(
      getPropertyOwnerId({ ownerId: 'legacy-owner' }, null),
      'legacy-owner'
    );
  }],

  ['missing owner returns an empty value', () => {
    assert.equal(getPropertyOwnerId({}, {}), '');
  }],

  ['private fields are merged over public fields', () => {
    const result = mergePropertyData(
      { title: 'Plot', sellerPhone: '1111111111' },
      { sellerPhone: '2222222222' }
    );

    assert.equal(result.title, 'Plot');
    assert.equal(result.sellerPhone, '2222222222');
  }],

  ['photo keys are collected and deduplicated', () => {
    assert.deepEqual(
      collectPropertyPhotoKeys(
        {
          photoKeys: ['properties/u/a.jpg', 'properties/u/b.jpg'],
          coverPhotoKey: 'properties/u/a.jpg'
        },
        null
      ),
      ['properties/u/a.jpg', 'properties/u/b.jpg']
    );
  }],

  ['private photo keys take precedence after migration', () => {
    assert.deepEqual(
      collectPropertyPhotoKeys(
        { photoKeys: ['legacy.jpg'] },
        { photoKeys: ['private.jpg'] }
      ),
      ['private.jpg']
    );
  }],

  ['malformed photo-key list is rejected', () => {
    assert.throws(
      () => collectPropertyPhotoKeys({ photoKeys: 'not-an-array' }, null),
      /INVALID_PHOTO_KEYS_FIELD/
    );
  }],

  ['existing private owner is preserved', () => {
    const result = buildPrivatePropertyData(
      {
        ownerId: 'seller-1',
        sellerPhone: '1111111111',
        photoKeys: ['one.jpg']
      },
      {
        ownerId: 'seller-1',
        sellerPhone: '2222222222'
      }
    );

    assert.equal(result.ownerId, 'seller-1');
    assert.equal(result.sellerPhone, '2222222222');
    assert.deepEqual(result.photoKeys, ['one.jpg']);
  }],

  ['conflicting owners are rejected', () => {
    assert.throws(
      () => buildPrivatePropertyData(
        { ownerId: 'seller-1' },
        { ownerId: 'seller-2' }
      ),
      /PROPERTY_OWNER_CONFLICT/
    );
  }],

  ['missing owner prevents private record creation', () => {
    assert.throws(
      () => buildPrivatePropertyData({}, {}),
      /MISSING_PROPERTY_OWNER/
    );
  }],

  ['contact data excludes seller UID, email and private R2 keys', () => {
    const result = buildPropertyContactInfo({
      ownerId: 'seller-1',
      ownerName: 'Seller',
      sellerPhone: '9876543210',
      waVerified: true,
      ownerEmail: 'seller@example.com',
      paymentProofKey: 'proof/private.jpg',
      photoKeys: ['private/photo.jpg'],
      coverPhotoKey: 'private/cover.jpg'
    });

    assert.deepEqual(result, {
      ownerName: 'Seller',
      sellerPhone: '9876543210',
      waVerified: false
    });
  }],

  ['legacy WhatsApp verification claim is always cleared', () => {
    const result = buildPrivatePropertyData(
      { ownerId: 'seller-1', waVerified: true },
      {}
    );

    assert.equal(result.waVerified, false);
  }]
];

let passed = 0;
let failed = 0;

for (const [name, callback] of tests) {
  try {
    callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(error.stack || error);
  }
}

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${tests.length}`);

if (failed) process.exitCode = 1;


const legacyOwnerPhone = buildPrivatePropertyData(
  { ownerId: 'owner-legacy', ownerPhone: '9876543210' },
  null
);
assert.equal(legacyOwnerPhone.sellerPhone, '9876543210');
assert.equal(legacyOwnerPhone.ownerPhone, '9876543210');
assert.equal(
  buildPropertyContactInfo(legacyOwnerPhone).sellerPhone,
  '9876543210'
);
console.log('PASS: legacy public ownerPhone is migrated into private seller contact');
