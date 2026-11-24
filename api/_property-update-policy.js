'use strict';

const EDITABLE_FIELDS = new Set([
  'title',
  'description',
  'type',
  'address',
  'city',
  'lat',
  'lng',
  'lengthFt',
  'widthFt',
  'areaSqft',
  'facing',
  'isCorner',
  'frontLen',
  'backLen',
  'leftLen',
  'rightLen',
  'frontRoad',
  'sideRoad',
  'plotNumber',
  'price',
  'isNegotiable'
]);

const STRING_LIMITS = {
  title: 160,
  description: 5000,
  address: 300,
  city: 120,
  plotNumber: 80
};

const NUMERIC_LIMITS = {
  price: 1_000_000_000_000,
  lengthFt: 1_000_000,
  widthFt: 1_000_000,
  areaSqft: 1_000_000_000,
  frontLen: 1_000_000,
  backLen: 1_000_000,
  leftLen: 1_000_000,
  rightLen: 1_000_000,
  frontRoad: 1_000_000,
  sideRoad: 1_000_000
};

const PROPERTY_TYPES = new Set(['plot', 'house', 'land', 'flat']);
const TRANSACTION_TYPES = new Set(['sale', 'rent']);
const RENT_PERIODS = new Set(['day', 'week', 'month', 'year']);
const FACINGS = new Set(['', 'East', 'West', 'North', 'South']);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizePropertyUpdateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Invalid request');
  }

  for (const key of Object.keys(body)) {
    if (!['propertyId', 'changes'].includes(key)) {
      fail(400, 'Invalid request field');
    }
  }

  const propertyId =
    typeof body.propertyId === 'string' ? body.propertyId.trim() : '';

  if (!/^[A-Za-z0-9_-]{1,150}$/.test(propertyId)) {
    fail(400, 'Valid property ID required');
  }

  const source = body.changes;

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail(400, 'Property changes are required');
  }

  const fields = Object.keys(source);

  if (!fields.length) {
    fail(400, 'At least one property field must be changed');
  }

  const patch = {};

  for (const field of fields) {
    if (!EDITABLE_FIELDS.has(field)) {
      fail(400, `Property field cannot be edited: ${field}`);
    }

    const value = source[field];

    if (Object.prototype.hasOwnProperty.call(STRING_LIMITS, field)) {
      if (typeof value !== 'string') {
        fail(400, `Invalid ${field}`);
      }

      const cleaned = value.trim();

      if (cleaned.length > STRING_LIMITS[field]) {
        fail(400, `${field} is too long`);
      }

      if (['title', 'address'].includes(field) && !cleaned) {
        fail(400, `${field} is required`);
      }

      patch[field] = cleaned;
      continue;
    }

    if (field === 'type') {
      if (typeof value !== 'string' ||
          !PROPERTY_TYPES.has(value.trim().toLowerCase())) {
        fail(400, 'Invalid property type');
      }

      patch.type = value.trim().toLowerCase();
      continue;
    }

    if (field === 'facing') {
      if (typeof value !== 'string' || !FACINGS.has(value.trim())) {
        fail(400, 'Invalid property facing');
      }

      patch.facing = value.trim();
      continue;
    }

    if (field === 'isCorner' || field === 'isNegotiable') {
      if (typeof value !== 'boolean') {
        fail(400, `Invalid ${field}`);
      }

      patch[field] = value;
      continue;
    }

    if (field === 'lat' || field === 'lng') {
      if (value === null) {
        patch[field] = null;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        const min = field === 'lat' ? -90 : -180;
        const max = field === 'lat' ? 90 : 180;

        if (value < min || value > max) {
          fail(400, `Invalid ${field}`);
        }

        patch[field] = value;
      } else {
        fail(400, `Invalid ${field}`);
      }

      continue;
    }

    if (Object.prototype.hasOwnProperty.call(NUMERIC_LIMITS, field)) {
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          value < 0 || value > NUMERIC_LIMITS[field]) {
        fail(400, `Invalid ${field}`);
      }

      if (field === 'price' && value <= 0) {
        fail(400, 'Price must be greater than zero');
      }

      patch[field] = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'lat') !==
      Object.prototype.hasOwnProperty.call(patch, 'lng')) {
    fail(400, 'Latitude and longitude must be updated together');
  }

  return { propertyId, patch };
}

function validateMergedProperty(existing, patch) {
  const merged = { ...existing, ...patch };

  if (typeof merged.title !== 'string' || !merged.title.trim()) {
    fail(400, 'Property title is required');
  }

  if (typeof merged.address !== 'string' || !merged.address.trim()) {
    fail(400, 'Property address is required');
  }

  if (!PROPERTY_TYPES.has(String(merged.type || '').toLowerCase())) {
    fail(400, 'Invalid stored property type');
  }

  const price = Number(merged.price);

  if (!Number.isFinite(price) || price <= 0 ||
      price > NUMERIC_LIMITS.price) {
    fail(400, 'Invalid property price');
  }

  const transactionType = String(merged.transactionType || 'sale').toLowerCase();

  if (!TRANSACTION_TYPES.has(transactionType)) {
    fail(400, 'Invalid stored transaction type');
  }

  if (transactionType === 'rent') {
    const period = String(merged.rentPeriod || 'month').toLowerCase();

    if (!RENT_PERIODS.has(period)) {
      fail(400, 'Invalid rental period');
    }

    if (!merged.rentPeriod) patch.rentPeriod = 'month';
  } else if (patch.transactionType === 'sale') {
    patch.rentPeriod = null;
  } else if (patch.rentPeriod != null) {
    fail(400, 'Rental period is not valid for a sale listing');
  }

  return patch;
}

module.exports = {
  EDITABLE_FIELDS,
  normalizePropertyUpdateRequest,
  validateMergedProperty
};
