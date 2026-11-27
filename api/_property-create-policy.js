'use strict';

const {
  parseOpaquePropertyImageKey,
  isReadyUnassignedPropertyUpload
} = require('./_property-upload-registry');

const MAX_PROPERTY_PHOTOS = 100;
const PROPERTY_TYPES = ['plot', 'house', 'land', 'flat'];
const FACING_DIRECTIONS = [
  'North', 'North-East', 'East', 'South-East',
  'South', 'South-West', 'West', 'North-West'
];
const SOCIAL_PROMOTION_PLATFORMS = ['youtube', 'facebook', 'instagram'];

const BADGE_KEYS = [
  'verifiedOwner',
  'verifiedPhone',
  'verifiedProperty',
  'visitPhotos',
  'location'
];

const PROPERTY_INPUT_FIELDS = new Set([
  'title', 'description', 'type', 'transactionType', 'rentPeriod',
  'address', 'city',
  'lat', 'lng', 'lengthFt', 'widthFt', 'areaSqft',
  'facing', 'isCorner', 'frontLen', 'backLen',
  'leftLen', 'rightLen', 'frontRoad', 'sideRoad',
  'plotNumber', 'badgesRequested', 'price',
  'isNegotiable', 'featuredRequested', 'plotLayoutSkipped', 'plotLayout',
  'socialPromotionPlatforms'
]);

const REQUEST_INPUT_FIELDS = new Set([
  'property', 'sellerPhone', 'photoKeys'
]);

const NUMERIC_LIMITS = {
  lengthFt: 1000000,
  widthFt: 1000000,
  areaSqft: 1000000000,
  frontLen: 1000000,
  backLen: 1000000,
  leftLen: 1000000,
  rightLen: 1000000,
  frontRoad: 1000000,
  sideRoad: 1000000
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanString(value, field, maxLength, required = false) {
  if (value == null && !required) return '';

  if (typeof value !== 'string') {
    if (required) fail(`INVALID_${field.toUpperCase()}`);
    return '';
  }

  const result = value.trim();

  if (required && !result) fail(`MISSING_${field.toUpperCase()}`);
  if (result.length > maxLength) fail(`${field.toUpperCase()}_TOO_LONG`);

  return result;
}

function numeric(value, field, max = 1000000000) {
  if (value == null || value === '') return 0;

  const result = Number(value);

  if (!Number.isFinite(result) || result < 0 || result > max) {
    fail(`INVALID_${field.toUpperCase()}`);
  }

  return result;
}

function coordinate(value, field, min, max) {
  if (value == null || value === '') return null;

  const result = Number(value);

  if (!Number.isFinite(result) || result < min || result > max) {
    fail(`INVALID_${field.toUpperCase()}`);
  }

  return result;
}

function boolean(value, field, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') fail(`INVALID_${field.toUpperCase()}`);
  return value;
}

function normalizePhone(value) {
  if (typeof value !== 'string') fail('INVALID_SELLER_PHONE');

  let digits = value.replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    fail('INVALID_SELLER_PHONE');
  }

  return digits;
}

function normalizePhotoKeys(value, maxPhotos = MAX_PROPERTY_PHOTOS) {
  if (value == null) return [];

  if (
    !Number.isSafeInteger(maxPhotos) ||
    maxPhotos < 1 ||
    maxPhotos > MAX_PROPERTY_PHOTOS ||
    !Array.isArray(value) ||
    value.length > maxPhotos
  ) {
    fail('INVALID_PHOTO_KEYS');
  }

  const keys = [];
  const seen = new Set();

  for (const key of value) {
    const parsed = parseOpaquePropertyImageKey(key);

    if (!parsed) fail('INVALID_PROPERTY_IMAGE_KEY');
    if (seen.has(key)) fail('DUPLICATE_PROPERTY_IMAGE_KEY');

    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function validateReadyPhotoUploads(
  photoKeys,
  uploadRecords,
  ownerUid,
  nowMs = Date.now()
) {
  if (!Array.isArray(photoKeys) || !Array.isArray(uploadRecords) ||
      photoKeys.length !== uploadRecords.length) {
    fail('PROPERTY_UPLOAD_RECORDS_MISMATCH');
  }

  const expectedTypes = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
  };

  return photoKeys.map((key, index) => {
    const parsed = parseOpaquePropertyImageKey(key);
    const upload = uploadRecords[index];

    if (!parsed || !isReadyUnassignedPropertyUpload(
      upload, ownerUid, key, nowMs
    )) {
      fail('PROPERTY_IMAGE_NOT_READY_OR_NOT_OWNED');
    }

    if (upload.verifiedContentType !== expectedTypes[parsed.extension]) {
      fail('PROPERTY_IMAGE_TYPE_NOT_VERIFIED');
    }

    if (
      !Number.isSafeInteger(upload.actualSize) ||
      upload.actualSize <= 0 ||
      upload.actualSize > 5 * 1024 * 1024
    ) {
      fail('PROPERTY_IMAGE_SIZE_NOT_VERIFIED');
    }

    return {
      uploadId: parsed.uploadId,
      key
    };
  });
}

function normalizeSocialPromotionPlatforms(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > SOCIAL_PROMOTION_PLATFORMS.length) {
    fail('INVALID_SOCIAL_PROMOTION_PLATFORMS');
  }
  const normalized = value.map(item => {
    if (typeof item !== 'string') fail('INVALID_SOCIAL_PROMOTION_PLATFORM');
    const platform = item.trim().toLowerCase();
    if (!SOCIAL_PROMOTION_PLATFORMS.includes(platform)) {
      fail('INVALID_SOCIAL_PROMOTION_PLATFORM');
    }
    return platform;
  });
  if (new Set(normalized).size !== normalized.length) {
    fail('DUPLICATE_SOCIAL_PROMOTION_PLATFORM');
  }
  return normalized;
}

function buildInitialSocialPromotions(platforms) {
  const result = {};
  for (const platform of platforms) {
    result[platform] = {
      paymentStatus: 'unpaid',
      status: 'awaiting_payment',
      published: false
    };
  }
  return result;
}

function normalizeBadgesRequested(value) {
  const source = value == null ? {} : value;

  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source)
  ) {
    fail('INVALID_BADGES_REQUESTED');
  }

  for (const key of Object.keys(source)) {
    if (!BADGE_KEYS.includes(key)) fail('INVALID_BADGE_KEY');
  }

  return Object.fromEntries(
    BADGE_KEYS.map(key => [
      key,
      boolean(source[key], `badge_${key}`)
    ])
  );
}

function normalizePlotLayout(value, facing, isCorner) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_PLOT_LAYOUT');
  }

  const allowed = new Set([
    'schemaVersion', 'dimensionInputMode', 'measurementUnit',
    'frontDirection', 'isCorner', 'cornerRoadSide', 'boundaries',
    'roadWidths', 'roadWidthUnit', 'drawingNote'
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('INVALID_PLOT_LAYOUT_FIELD');
  }

  if (value.schemaVersion !== 1) fail('INVALID_PLOT_LAYOUT_VERSION');
  const dimensionInputMode = cleanString(
    value.dimensionInputMode, 'dimensionInputMode', 20, true
  );
  if (!['lengthWidth', 'fourSides'].includes(dimensionInputMode)) {
    fail('INVALID_PLOT_LAYOUT_MODE');
  }
  if (value.measurementUnit !== 'ft' || value.roadWidthUnit !== 'ft') {
    fail('INVALID_PLOT_LAYOUT_UNIT');
  }

  const frontDirection = cleanString(
    value.frontDirection, 'frontDirection', 20, true
  );
  if (!FACING_DIRECTIONS.includes(frontDirection) || frontDirection !== facing) {
    fail('INVALID_PLOT_LAYOUT_DIRECTION');
  }

  const layoutCorner = boolean(value.isCorner, 'plotLayout_isCorner');
  if (layoutCorner !== isCorner) fail('PLOT_LAYOUT_CORNER_MISMATCH');
  const cornerRoadSide = value.cornerRoadSide == null
    ? ''
    : cleanString(value.cornerRoadSide, 'cornerRoadSide', 10);
  if (layoutCorner && !['left', 'right'].includes(cornerRoadSide)) {
    fail('INVALID_CORNER_ROAD_SIDE');
  }
  if (!layoutCorner && cornerRoadSide) fail('INVALID_CORNER_ROAD_SIDE');

  const normalizeMeasureMap = (source, allowedKeys, field) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      fail(`INVALID_${field.toUpperCase()}`);
    }
    for (const key of Object.keys(source)) {
      if (!allowedKeys.includes(key)) fail(`INVALID_${field.toUpperCase()}_KEY`);
    }
    const result = {};
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const raw = source[key];
      result[key] = raw == null || raw === ''
        ? null
        : numeric(raw, `${field}_${key}`, NUMERIC_LIMITS.frontRoad);
    }
    return result;
  };

  const boundaries = normalizeMeasureMap(
    value.boundaries, ['front', 'back', 'left', 'right'], 'plot_boundaries'
  );
  const roadWidths = normalizeMeasureMap(
    value.roadWidths, ['front', 'left', 'right'], 'plot_road_widths'
  );
  if (!Object.prototype.hasOwnProperty.call(boundaries, 'front') ||
      !Object.prototype.hasOwnProperty.call(boundaries, 'back') ||
      !Object.prototype.hasOwnProperty.call(boundaries, 'left') ||
      !Object.prototype.hasOwnProperty.call(boundaries, 'right') ||
      !Object.prototype.hasOwnProperty.call(roadWidths, 'front')) {
    fail('INVALID_PLOT_LAYOUT_MEASUREMENTS');
  }
  if (layoutCorner && !Object.prototype.hasOwnProperty.call(roadWidths, cornerRoadSide)) {
    fail('INVALID_CORNER_ROAD_WIDTH');
  }

  const drawingNote = cleanString(value.drawingNote, 'drawingNote', 240);
  return {
    schemaVersion: 1,
    dimensionInputMode,
    measurementUnit: 'ft',
    frontDirection,
    isCorner: layoutCorner,
    cornerRoadSide: layoutCorner ? cornerRoadSide : null,
    boundaries,
    roadWidths,
    roadWidthUnit: 'ft',
    drawingNote
  };
}

function normalizePropertyCreateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('INVALID_REQUEST');
  }

  for (const field of Object.keys(body)) {
    if (!REQUEST_INPUT_FIELDS.has(field)) {
      fail('INVALID_REQUEST_FIELD');
    }
  }

  const source = body.property;

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('PROPERTY_DATA_REQUIRED');
  }

  for (const field of Object.keys(source)) {
    if (!PROPERTY_INPUT_FIELDS.has(field)) {
      fail('INVALID_PROPERTY_FIELD');
    }
  }

  const type = cleanString(source.type, 'type', 20, true).toLowerCase();

  if (!PROPERTY_TYPES.includes(type)) {
    fail('INVALID_PROPERTY_TYPE');
  }

  const transactionType = source.transactionType == null
    ? 'sale'
    : cleanString(source.transactionType, 'transactionType', 10, true).toLowerCase();

  if (!['sale', 'rent'].includes(transactionType)) {
    fail('INVALID_TRANSACTION_TYPE');
  }

  let rentPeriod = null;

  if (transactionType === 'rent') {
    rentPeriod = source.rentPeriod == null
      ? 'month'
      : cleanString(source.rentPeriod, 'rentPeriod', 10, true).toLowerCase();

    if (!['day', 'week', 'month', 'year'].includes(rentPeriod)) {
      fail('INVALID_RENT_PERIOD');
    }
  } else if (source.rentPeriod != null) {
    fail('INVALID_RENT_PERIOD');
  }

  const price = Number(source.price);

  if (!Number.isFinite(price) || price <= 0 || price > 1000000000000) {
    fail('INVALID_PRICE');
  }

  const facing = cleanString(source.facing, 'facing', 20);

  if (facing && !FACING_DIRECTIONS.includes(facing)) {
    fail('INVALID_FACING');
  }

  const normalizedLat=coordinate(source.lat,'latitude',-90,90);
  const normalizedLng=coordinate(source.lng,'longitude',-180,180);
  if(normalizedLat===null||normalizedLng===null)fail('PROPERTY_MAP_PIN_REQUIRED');

  const isCorner = boolean(source.isCorner, 'isCorner');
  const plotLayoutSkipped = boolean(source.plotLayoutSkipped, 'plotLayoutSkipped');
  const isPlotLike = type === 'plot' || type === 'land';
  if (!isPlotLike && (source.plotLayout != null || plotLayoutSkipped)) {
    fail('PLOT_LAYOUT_NOT_APPLICABLE');
  }
  if (plotLayoutSkipped && source.plotLayout != null) {
    fail('PLOT_LAYOUT_CANNOT_BE_SKIPPED_AND_SUBMITTED');
  }
  const plotLayout = isPlotLike && !plotLayoutSkipped
    ? normalizePlotLayout(source.plotLayout, facing, isCorner)
    : null;
  const socialPromotionPlatforms = normalizeSocialPromotionPlatforms(
    source.socialPromotionPlatforms
  );

  const publicData = {
    title: cleanString(source.title, 'title', 160, true),
    description: cleanString(source.description, 'description', 5000),
    type,
    transactionType,
    rentPeriod,
    address: cleanString(source.address, 'address', 300, true),
    city: cleanString(source.city, 'city', 120) || 'Hyderabad',

    lat: normalizedLat,
    lng: normalizedLng,

    lengthFt: numeric(source.lengthFt, 'lengthFt', NUMERIC_LIMITS.lengthFt),
    widthFt: numeric(source.widthFt, 'widthFt', NUMERIC_LIMITS.widthFt),
    areaSqft: numeric(source.areaSqft, 'areaSqft', NUMERIC_LIMITS.areaSqft),

    facing,
    isCorner,

    frontLen: numeric(source.frontLen, 'frontLen', NUMERIC_LIMITS.frontLen),
    backLen: numeric(source.backLen, 'backLen', NUMERIC_LIMITS.backLen),
    leftLen: numeric(source.leftLen, 'leftLen', NUMERIC_LIMITS.leftLen),
    rightLen: numeric(source.rightLen, 'rightLen', NUMERIC_LIMITS.rightLen),
    frontRoad: numeric(source.frontRoad, 'frontRoad', NUMERIC_LIMITS.frontRoad),
    sideRoad: numeric(source.sideRoad, 'sideRoad', NUMERIC_LIMITS.sideRoad),

    plotNumber: cleanString(source.plotNumber, 'plotNumber', 80),
    plotLayoutSkipped: isPlotLike ? plotLayoutSkipped : false,
    ...(plotLayout ? { plotLayout } : {}),
    badgesRequested: normalizeBadgesRequested(source.badgesRequested),

    badges: Object.fromEntries(BADGE_KEYS.map(key => [key, false])),
    urgent: false,
    premiumListing: false,
    price,
    isNegotiable: boolean(source.isNegotiable, 'isNegotiable'),
    isFeatured: false,
    featuredRequested: boolean(source.featuredRequested, 'featuredRequested'),
    socialPromotionPlatforms,
    socialPromotions: buildInitialSocialPromotions(socialPromotionPlatforms),

    status: 'pending',
    viewsCount: 0,
    photos: []
  };

  return {
    publicData,
    sellerPhone: normalizePhone(body.sellerPhone),
    photoKeys: normalizePhotoKeys(body.photoKeys)
  };
}

function buildPropertyCreateDocuments({
  normalized,
  owner,
  publicBaseUrl
}) {
  if (!normalized || !normalized.publicData) fail('INVALID_NORMALIZED_PROPERTY');

  const uid = String(owner && owner.uid || '').trim();
  const email = String(owner && owner.email || '').trim().toLowerCase();

  if (!uid || uid.includes('/') || uid.length > 128) {
    fail('INVALID_AUTHENTICATED_OWNER');
  }

  if (
    !email ||
    email.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  ) {
    fail('INVALID_AUTHENTICATED_EMAIL');
  }

  const ownerName = cleanString(
    owner.displayName,
    'ownerName',
    120
  ) || 'User';

  const keys = normalized.photoKeys;
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');

  if (keys.length && !/^https:\/\//i.test(base)) {
    fail('INVALID_PUBLIC_IMAGE_BASE_URL');
  }

  const photos = keys.map(key => `${base}/${key}`);

  const publicData = {
    ...normalized.publicData,
    photos
  };

  if (photos.length) {
    publicData.coverPhoto = photos[0];
  }

  const privateData = {
    ownerId: uid,
    ownerEmail: email,
    ownerName,
    sellerPhone: normalized.sellerPhone,
    waVerified: false,
    photoKeys: [...keys]
  };

  if (keys.length) {
    privateData.coverPhotoKey = keys[0];
  }

  const contactInfo = {
    ownerName,
    sellerPhone: normalized.sellerPhone,
    waVerified: false
  };

  return {
    publicData,
    privateData,
    contactInfo
  };
}

module.exports = {
  PROPERTY_TYPES,
  FACING_DIRECTIONS,
  MAX_PROPERTY_PHOTOS,
  BADGE_KEYS,
  SOCIAL_PROMOTION_PLATFORMS,
  normalizeSocialPromotionPlatforms,
  buildInitialSocialPromotions,
  normalizePhone,
  normalizePhotoKeys,
  normalizePlotLayout,
  normalizePropertyCreateRequest,
  validateReadyPhotoUploads,
  buildPropertyCreateDocuments
};
