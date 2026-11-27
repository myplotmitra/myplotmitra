'use strict';

const assert = require('node:assert/strict');

const {
  normalizePropertyCreateRequest,
  validateReadyPhotoUploads,
  buildPropertyCreateDocuments
} = require('../api/_property-create-policy');

const owner = {
  uid: 'seller-uid-123',
  email: 'seller@example.com',
  displayName: 'Test Seller'
};

const uuid = '550e8400-e29b-41d4-a716-446655440000';
const key = `properties/${uuid}.jpg`;

function validBody(overrides = {}) {
  return {
    property: {
      title: 'East Facing Plot',
      description: 'Residential property near main road',
      type: 'plot',
      address: 'Test locality',
      city: 'Anantapur',
      lat: 14.6819,
      lng: 77.6006,
      lengthFt: 40,
      widthFt: 60,
      areaSqft: 2400,
      facing: 'East',
      isCorner: true,
      frontLen: 40,
      backLen: 40,
      leftLen: 60,
      rightLen: 60,
      frontRoad: 30,
      sideRoad: 0,
      plotNumber: 'P-12',
      badgesRequested: { verifiedOwner: true },
      isNegotiable: true,
      featuredRequested: false,
      price: 4500000
    },
    sellerPhone: '9876543210',
    photoKeys: [key],
    ...overrides
  };
}

const normalized = normalizePropertyCreateRequest(validBody());

const now = Date.now();

function readyRecord(overrides = {}) {
  return {
    ownerId: owner.uid,
    key,
    status: 'ready',
    propertyId: null,
    expiresAt: new Date(now + 60000),
    verifiedContentType: 'image/jpeg',
    actualSize: 250000,
    ...overrides
  };
}

assert.equal(
  validateReadyPhotoUploads([key], [readyRecord()], owner.uid, now).length,
  1
);
console.log('PASS: verified ready image owned by seller is accepted');

assert.throws(
  () => validateReadyPhotoUploads(
    [key], [readyRecord({ ownerId: 'another-user' })], owner.uid, now
  ),
  /PROPERTY_IMAGE_NOT_READY_OR_NOT_OWNED/
);
console.log('PASS: another seller upload is rejected');

assert.throws(
  () => validateReadyPhotoUploads(
    [key], [readyRecord({ status: 'reserved' })], owner.uid, now
  ),
  /PROPERTY_IMAGE_NOT_READY_OR_NOT_OWNED/
);
console.log('PASS: image that has not been finalized is rejected');

assert.throws(
  () => validateReadyPhotoUploads(
    [key], [readyRecord({ expiresAt: new Date(now - 1) })], owner.uid, now
  ),
  /PROPERTY_IMAGE_NOT_READY_OR_NOT_OWNED/
);
console.log('PASS: expired image reservation is rejected');

assert.throws(
  () => validateReadyPhotoUploads(
    [key], [readyRecord({ verifiedContentType: 'image/png' })], owner.uid, now
  ),
  /PROPERTY_IMAGE_TYPE_NOT_VERIFIED/
);
console.log('PASS: mismatched verified MIME type is rejected');

assert.throws(
  () => validateReadyPhotoUploads(
    [key], [readyRecord({ actualSize: 5 * 1024 * 1024 + 1 })], owner.uid, now
  ),
  /PROPERTY_IMAGE_SIZE_NOT_VERIFIED/
);
console.log('PASS: oversized verified image is rejected');

assert.throws(
  () => validateReadyPhotoUploads([key], [], owner.uid, now),
  /PROPERTY_UPLOAD_RECORDS_MISMATCH/
);
console.log('PASS: missing upload registry record is rejected');

const documents = buildPropertyCreateDocuments({
  normalized,
  owner,
  publicBaseUrl: 'https://images.example.test'
});

assert.equal(documents.publicData.title, 'East Facing Plot');
assert.equal(documents.publicData.status, 'pending');
assert.equal(documents.publicData.viewsCount, 0);
assert.equal(documents.publicData.isFeatured, false);
assert.equal(documents.publicData.coverPhoto, `https://images.example.test/${key}`);
assert.deepEqual(documents.publicData.photos, [`https://images.example.test/${key}`]);
console.log('PASS: public property document preserves approved listing fields');

assert.equal(documents.publicData.ownerId, undefined);
assert.equal(documents.publicData.ownerEmail, undefined);
assert.equal(documents.publicData.ownerName, undefined);
assert.equal(documents.publicData.sellerPhone, undefined);
assert.equal(documents.publicData.waVerified, undefined);
assert.equal(documents.publicData.photoKeys, undefined);
assert.equal(documents.publicData.coverPhotoKey, undefined);
console.log('PASS: public property document excludes every private field');

assert.equal(documents.privateData.ownerId, owner.uid);
assert.equal(documents.privateData.ownerEmail, owner.email);
assert.equal(documents.privateData.ownerName, owner.displayName);
assert.equal(documents.privateData.sellerPhone, '9876543210');
assert.equal(documents.privateData.waVerified, false);
assert.deepEqual(documents.privateData.photoKeys, [key]);
console.log('PASS: private owner and photo metadata are stored separately');

assert.equal(documents.contactInfo.ownerId, undefined);
assert.equal(documents.contactInfo.ownerEmail, undefined);
assert.equal(documents.contactInfo.sellerPhone, '9876543210');
assert.equal(documents.contactInfo.waVerified, false);
console.log('PASS: contact document contains no seller UID or email');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, ownerId: 'attacker' }
  })),
  /INVALID_PROPERTY_FIELD/
);
console.log('PASS: browser cannot inject owner identity into public property data');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, sellerPhone: '1111111111' }
  })),
  /INVALID_PROPERTY_FIELD/
);
console.log('PASS: seller phone is accepted only in the private request field');

assert.throws(
  () => normalizePropertyCreateRequest({
    ...validBody(),
    adminApproved: true
  }),
  /INVALID_REQUEST_FIELD/
);
console.log('PASS: unknown top-level request fields are rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, type: 'commercial-special' }
  })),
  /INVALID_PROPERTY_TYPE/
);
console.log('PASS: unsupported property type is rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, price: -1 }
  })),
  /INVALID_PRICE/
);
console.log('PASS: negative price is rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, lat: 1000 }
  })),
  /INVALID_LATITUDE/
);
console.log('PASS: invalid coordinates are rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    sellerPhone: '12345'
  })),
  /INVALID_SELLER_PHONE/
);
console.log('PASS: malformed Indian seller phone is rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    photoKeys: ['properties/seller-uid-123/old.jpg']
  })),
  /INVALID_PROPERTY_IMAGE_KEY/
);
console.log('PASS: legacy and unregistered key formats are rejected for new submissions');

assert.doesNotThrow(() => normalizePropertyCreateRequest(validBody({
  photoKeys: Array.from({ length: 7 }, (_, i) =>
    `properties/550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}.jpg`
  )
})), 'seven property photos should pass the shared 100-photo ceiling');
console.log('PASS: seven property photos are accepted by the shared policy');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    photoKeys: Array.from({ length: 101 }, (_, i) =>
      `properties/550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}.jpg`
    )
  })),
  /INVALID_PHOTO_KEYS/
);
console.log('PASS: more than 100 property photos are rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: { ...validBody().property, adminApproved: true }
  })),
  /INVALID_PROPERTY_FIELD/
);
console.log('PASS: server-controlled approval fields are rejected');

assert.throws(
  () => buildPropertyCreateDocuments({
    normalized,
    owner: { uid: owner.uid, email: 'invalid-email', displayName: 'Seller' },
    publicBaseUrl: 'https://images.example.test'
  }),
  /INVALID_AUTHENTICATED_EMAIL/
);
console.log('PASS: invalid authenticated owner email is rejected');

assert.throws(
  () => buildPropertyCreateDocuments({
    normalized,
    owner,
    publicBaseUrl: 'http://unsafe.example.test'
  }),
  /INVALID_PUBLIC_IMAGE_BASE_URL/
);
console.log('PASS: non-HTTPS public image base is rejected');

const noPhoto = normalizePropertyCreateRequest(
  validBody({ photoKeys: [] })
);

const noPhotoDocs = buildPropertyCreateDocuments({
  normalized: noPhoto,
  owner,
  publicBaseUrl: ''
});

assert.deepEqual(noPhotoDocs.publicData.photos, []);
assert.equal(noPhotoDocs.publicData.coverPhoto, undefined);
assert.deepEqual(noPhotoDocs.privateData.photoKeys, []);
console.log('PASS: property without photos is supported');

// Rental transaction fields are normalized and validated by the server.
const defaultSale = normalizePropertyCreateRequest(validBody());
assert.equal(defaultSale.publicData.transactionType, 'sale');
assert.equal(defaultSale.publicData.rentPeriod, null);
console.log('PASS: existing requests default to sale');

const monthlyRent = normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    transactionType: 'rent'
  }
}));
assert.equal(monthlyRent.publicData.transactionType, 'rent');
assert.equal(monthlyRent.publicData.rentPeriod, 'month');
console.log('PASS: rental listing defaults to monthly rent');

for (const period of ['day', 'week', 'month', 'year']) {
  const result = normalizePropertyCreateRequest(validBody({
    property: {
      ...validBody().property,
      transactionType: 'rent',
      rentPeriod: period
    }
  }));
  assert.equal(result.publicData.rentPeriod, period);
}
console.log('PASS: supported rental periods are accepted');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: {
      ...validBody().property,
      transactionType: 'lease-sale'
    }
  })),
  /INVALID_TRANSACTION_TYPE/
);
console.log('PASS: unsupported transaction type is rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: {
      ...validBody().property,
      transactionType: 'rent',
      rentPeriod: 'fortnight'
    }
  })),
  /INVALID_RENT_PERIOD/
);
console.log('PASS: unsupported rental period is rejected');

assert.throws(
  () => normalizePropertyCreateRequest(validBody({
    property: {
      ...validBody().property,
      rentPeriod: 'month'
    }
  })),
  /INVALID_RENT_PERIOD/
);
console.log('PASS: sale listing cannot inject a rental period');

console.log('\nPassed: 21');
console.log('Failed: 0');


// Flutter's extended plot form sends a strictly versioned, normalized layout.
const flutterPlotLayout = {
  schemaVersion: 1,
  dimensionInputMode: 'fourSides',
  measurementUnit: 'ft',
  frontDirection: 'North-East',
  isCorner: true,
  cornerRoadSide: 'right',
  boundaries: { front: 40, back: 38, left: 60, right: 62 },
  roadWidths: { front: 30, right: 20 },
  roadWidthUnit: 'ft',
  drawingNote: 'Schematic drawing only.'
};
const flutterLayoutRequest = normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    facing: 'North-East',
    isCorner: true,
    plotLayoutSkipped: false,
    plotLayout: flutterPlotLayout
  }
}));
assert.equal(flutterLayoutRequest.publicData.facing, 'North-East');
assert.equal(flutterLayoutRequest.publicData.plotLayout.frontDirection, 'North-East');
assert.equal(flutterLayoutRequest.publicData.plotLayout.roadWidths.right, 20);
console.log('PASS: Flutter versioned plot layout is accepted and normalized');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    facing: 'North-East',
    plotLayoutSkipped: false,
    plotLayout: { ...flutterPlotLayout, ownerId: 'attacker' }
  }
})), /INVALID_PLOT_LAYOUT_FIELD/);
console.log('PASS: unknown plot-layout fields are rejected');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    facing: 'North-East',
    plotLayoutSkipped: false,
    plotLayout: { ...flutterPlotLayout, frontDirection: 'South' }
  }
})), /INVALID_PLOT_LAYOUT_DIRECTION/);
console.log('PASS: plot-layout facing cannot conflict with the property-facing field');

const skippedLayout = normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    plotLayoutSkipped: true
  }
}));
assert.equal(skippedLayout.publicData.plotLayoutSkipped, true);
assert.equal(Object.hasOwn(skippedLayout.publicData, 'plotLayout'), false);
console.log('PASS: plot-layout skip choice is preserved without fabricated measurements');


for (const facing of [
  'North', 'North-East', 'East', 'South-East',
  'South', 'South-West', 'West', 'North-West'
]) {
  const input = validBody({
    property: { ...validBody().property, facing }
  });
  assert.equal(normalizePropertyCreateRequest(input).publicData.facing, facing);
}
console.log('PASS: all eight compass directions are supported by property creation');


const socialNormalized = normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    socialPromotionPlatforms: ['youtube', 'instagram']
  }
}));
assert.deepEqual(socialNormalized.publicData.socialPromotionPlatforms, ['youtube', 'instagram']);
assert.equal(socialNormalized.publicData.socialPromotions.youtube.paymentStatus, 'unpaid');
assert.equal(socialNormalized.publicData.socialPromotions.instagram.published, false);
console.log('PASS: selected social promotions start unpaid and unpublished');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: { ...validBody().property, socialPromotionPlatforms: 'youtube' }
})), /INVALID_SOCIAL_PROMOTION_PLATFORMS/);
console.log('PASS: social promotion selection must be an array');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: { ...validBody().property, socialPromotionPlatforms: ['youtube', 'youtube'] }
})), /DUPLICATE_SOCIAL_PROMOTION_PLATFORM/);
console.log('PASS: duplicate social promotion platforms are rejected');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: { ...validBody().property, socialPromotionPlatforms: ['tiktok'] }
})), /INVALID_SOCIAL_PROMOTION_PLATFORM/);
console.log('PASS: unsupported social promotion platforms are rejected');

assert.throws(() => normalizePropertyCreateRequest(validBody({
  property: {
    ...validBody().property,
    socialPromotions: { youtube: { paymentStatus: 'paid', published: true, url: 'https://youtube.com/watch?v=attacker' } }
  }
})), /INVALID_PROPERTY_FIELD/);
console.log('PASS: clients cannot inject social promotion payment or publication state');
