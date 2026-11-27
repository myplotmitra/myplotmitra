'use strict';

const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const {
  admin,
  getClient,
  getBucket,
  authenticate,
  isAdmin
} = require('./_r2');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const user = await authenticate(req);
    const body = req.body || {};

    const category = String(body.category || '');
    const contentType = String(body.contentType || '');
    const size = Number(body.size);

    const config = CATEGORIES[category];
    const extension = TYPES[contentType];

    if (!config || !extension) {
      return res.status(400).json({ error: 'Unsupported upload type' });
    }

    if (!Number.isSafeInteger(size) || size <= 0 || size > config.maxBytes) {
      return res.status(400).json({ error: 'Invalid file size' });
    }

    if (config.adminOnly && !(await isAdmin(user))) {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    // New property images use opaque keys. The owner mapping stays in Firestore.
    const uploadId = category === 'property' ? crypto.randomUUID() : null;
    const filename = `${uploadId || crypto.randomUUID()}.${extension}`;
    const key = category === 'property'
      ? `${config.prefix}/${filename}`
      : `${config.prefix}/${user.uid}/${filename}`;

    const bucket = getBucket(config.private);
    const client = getClient(config.private);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: 300
    });

    const response = {
      key,
      uploadUrl,
      expiresIn: 300,
      contentType
    };

    if (!config.private) {
      const base = process.env.R2_PUBLIC_BASE_URL;

      if (!base || !/^https:\/\//i.test(base)) {
        throw new Error('R2 public URL is not configured correctly');
      }

      response.publicUrl =
        `${base.replace(/\/+$/, '')}/${key}`;
    }

    if (category === 'property') {
      const now = Date.now();

      // Firestore Admin SDK only. Browser clients do not write this registry.
      await admin.firestore()
        .collection('propertyUploads')
        .doc(uploadId)
        .create({
          ownerId: user.uid,
          key,
          status: 'reserved',
          contentType,
          declaredSize: size,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: admin.firestore.Timestamp.fromMillis(
            now + 30 * 60 * 1000
          )
        });
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('R2 upload URL error:', error.message);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Could not create upload URL'
    });
  }
};
