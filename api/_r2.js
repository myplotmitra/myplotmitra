const admin = require('firebase-admin');
const { S3Client } = require('@aws-sdk/client-s3');

const vercelEnvironment = String(
  process.env.VERCEL_ENV || 'development'
).toLowerCase();

const isLocalDevelopment =
  !process.env.VERCEL_ENV || vercelEnvironment === 'development';

const expectedFirebaseProjectId =
  vercelEnvironment === 'production'
    ? 'myplotmitra-d692c'
    : 'myplotmitra-preview-d8c47';

let serviceAccount;

if (isLocalDevelopment) {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_PREVIEW_B64;

  if (!encoded) {
    throw new Error('Local Preview Firebase credential is missing');
  }

  try {
    serviceAccount = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8')
    );
  } catch {
    throw new Error('Local Preview Firebase credential is invalid');
  }
} else {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  }

  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON');
  }
}

if (
  !serviceAccount.private_key ||
  !serviceAccount.client_email ||
  serviceAccount.project_id !== expectedFirebaseProjectId
) {
  throw new Error(
    `Firebase project or credentials mismatch for ${vercelEnvironment}. ` +
    `Expected ${expectedFirebaseProjectId}.`
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: expectedFirebaseProjectId,
  });
} else {
  const existingProjectId = admin.app().options.projectId;

  if (
    existingProjectId &&
    existingProjectId !== expectedFirebaseProjectId
  ) {
    throw new Error('Existing Firebase Admin app uses the wrong project');
  }
}

function getClient(privateBucket = false) {
  const accessKeyId = privateBucket
    ? process.env.R2_PRIVATE_ACCESS_KEY_ID
    : process.env.R2_PROPERTY_ACCESS_KEY_ID;

  const secretAccessKey = privateBucket
    ? process.env.R2_PRIVATE_SECRET_ACCESS_KEY
    : process.env.R2_PROPERTY_SECRET_ACCESS_KEY;

  if (!process.env.R2_ACCOUNT_ID || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 configuration is incomplete');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(privateBucket = false) {
  const bucket = privateBucket
    ? process.env.R2_PRIVATE_BUCKET
    : process.env.R2_PROPERTY_BUCKET;

  if (!bucket) throw new Error('R2 bucket configuration is missing');
  return bucket;
}

async function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  try {
    return await admin.auth().verifyIdToken(token, true);
  } catch {
    const error = new Error('Invalid or expired login session');
    error.status = 401;
    throw error;
  }
}

async function getUserRole(user) {
  if (!user || !user.uid || user.email_verified !== true || !user.email) {
    return null;
  }

  const snapshot = await admin.firestore()
    .collection('users')
    .doc(user.uid)
    .get();

  if (!snapshot.exists) return null;

  const profile = snapshot.data() || {};
  const tokenEmail = String(user.email).trim().toLowerCase();
  const profileEmail = String(profile.email || '').trim().toLowerCase();

  if (!profileEmail || profileEmail !== tokenEmail) return null;

  const role = String(profile.role || '').trim().toLowerCase();

  return ['user', 'admin', 'superadmin'].includes(role) ? role : null;
}

async function isAdmin(user) {
  const role = await getUserRole(user);
  return role === 'admin' || role === 'superadmin';
}

module.exports = {
  admin,
  getClient,
  getBucket,
  authenticate,
  isAdmin,
};
