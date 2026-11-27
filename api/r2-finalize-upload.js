'use strict';

const {
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');

const {
  admin,
  getClient,
  getBucket,
  authenticate,
  isAdmin
} = require('./_r2');

const {
  parseOpaquePropertyImageKey,
  timestampMillis
} = require('./_property-upload-registry');

const {
  isValidPropertyImageKey
} = require('./_r2-property-keys');

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const CATEGORIES = {
  property: {
    private: false,
    prefix: 'properties',
    maxBytes: 5 * 1024 * 1024
  },
  proof: {
    private: true,
    prefix: 'proofs',
    maxBytes: 5 * 1024 * 1024
  },
  'pending-banner': {
    private: true,
    prefix: 'banners',
    maxBytes: 3 * 1024 * 1024
  },
  'admin-banner': {
    private: false,
    prefix: 'banners',
    maxBytes: 3 * 1024 * 1024,
    adminOnly: true
  }
};

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function detectImageType(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return 'image/jpeg';

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) return 'image/png';

  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';

  return null;
}

async function removeInvalidObject(client, bucket, key) {
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  }));
}

async function readPropertyUploadReservation(db, uploadId, user, key) {
  const ref = db.collection('propertyUploads').doc(uploadId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    fail(403, 'Property upload reservation was not found');
  }

  const upload = snapshot.data() || {};
  const expiresAt = timestampMillis(upload.expiresAt);

  if (upload.ownerId !== user.uid || upload.key !== key) {
    fail(403, 'Property upload does not belong to this account');
  }

  if (!['reserved', 'ready'].includes(upload.status)) {
    fail(409, 'Property upload is no longer available for finalization');
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    fail(410, 'Property upload reservation has expired');
  }

  return ref;
}

async function markPropertyUploadReady(db, ref, user, key, actualSize, contentType) {
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);

    if (!snapshot.exists) {
      fail(409, 'Property upload reservation no longer exists');
    }

    const upload = snapshot.data() || {};

    if (upload.ownerId !== user.uid || upload.key !== key) {
      fail(403, 'Property upload ownership validation failed');
    }

    if (upload.status === 'ready') {
      const expiresAt = timestampMillis(upload.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        return; // Idempotent retry after a successful finalization.
      }
      fail(410, 'Property upload has expired');
    }

    if (upload.status !== 'reserved') {
      fail(409, 'Property upload cannot be finalized in its current state');
    }

    const reservationExpiry = timestampMillis(upload.expiresAt);
    if (
      !Number.isFinite(reservationExpiry) ||
      reservationExpiry <= Date.now()
    ) {
      fail(410, 'Property upload reservation has expired');
    }

    tx.update(ref, {
      status: 'ready',
      actualSize,
      verifiedContentType: contentType,
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + 24 * 60 * 60 * 1000
      )
    });
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  res.setHeader('Cache-Control', 'private, no-store');

  let client;
  let bucket;
  let key;

  try {
    const user = await authenticate(req);
    const body = req.body || {};

    const category = String(body.category || '');
    key = String(body.key || '');

    const config = CATEGORIES[category];

    if (!config) {
      return res.status(400).json({ error: 'Unsupported upload category' });
    }

    if (config.adminOnly && !(await isAdmin(user))) {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    let propertyUploadRef = null;

    if (category === 'property') {
      const opaque = parseOpaquePropertyImageKey(key);

      if (opaque) {
        const db = admin.firestore();
        propertyUploadRef = await readPropertyUploadReservation(
          db,
          opaque.uploadId,
          user,
          key
        );
      } else if (!isValidPropertyImageKey(key, user.uid)) {
        // Temporary compatibility for uploads whose old presigned URL
        // was issued before the opaque-key change.
        return res.status(403).json({
          error: 'Property upload key does not belong to this account'
        });
      }
    } else {
      const prefix = `${config.prefix}/${user.uid}/`;

      if (!key.startsWith(prefix)) {
        return res.status(403).json({
          error: 'Upload key does not belong to this account'
        });
      }

      const filename = key.slice(prefix.length);

      if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) {
        return res.status(400).json({ error: 'Invalid upload object key' });
      }
    }

    client = getClient(config.private);
    bucket = getBucket(config.private);

    const head = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    }));

    const actualSize = Number(head.ContentLength);
    const declaredType = String(head.ContentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (
      !Number.isSafeInteger(actualSize) ||
      actualSize <= 0 ||
      actualSize > config.maxBytes
    ) {
      await removeInvalidObject(client, bucket, key);

      return res.status(413).json({
        error: 'Actual uploaded file exceeds the allowed size. Object removed.'
      });
    }

    if (!TYPES[declaredType] || !key.toLowerCase().endsWith('.' + TYPES[declaredType])) {
      await removeInvalidObject(client, bucket, key);

      return res.status(415).json({
        error: 'Uploaded content type does not match its file extension. Object removed.'
      });
    }

    // Verify actual file bytes, not only the supplied Content-Type.
    const ranged = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: 'bytes=0-15'
    }));

    const chunks = [];

    for await (const chunk of ranged.Body) {
      chunks.push(Buffer.from(chunk));
    }

    const actualType = detectImageType(Buffer.concat(chunks));

    if (!actualType || actualType !== declaredType) {
      await removeInvalidObject(client, bucket, key);

      return res.status(415).json({
        error: 'Uploaded file is not a valid supported image. Object removed.'
      });
    }

    if (!config.private && category !== 'property') {
      const base = process.env.R2_PUBLIC_BASE_URL;

      if (!base || !/^https:\/\//i.test(base)) {
        throw new Error('R2 public URL is not configured correctly');
      }
    }

    const result = {
      key,
      size: actualSize,
      contentType: actualType
    };

    if (!config.private) {
      const base = process.env.R2_PUBLIC_BASE_URL;

      if (!base || !/^https:\/\//i.test(base)) {
        throw new Error('R2 public URL is not configured correctly');
      }

      result.publicUrl =
        `${base.replace(/\/+$/, '')}/${key}`;
    }

    if (propertyUploadRef) {
      await markPropertyUploadReady(
        admin.firestore(),
        propertyUploadRef,
        user,
        key,
        actualSize,
        actualType
      );
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('R2 upload finalization error:', error.message);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Could not verify uploaded file'
    });
  }
};
