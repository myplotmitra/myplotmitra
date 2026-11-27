'use strict';

// One-time Preview migration: move legacy private fields off public `properties`
// documents into `propertyPrivate` and `propertyContactInfo`.
//
// Default mode is dry-run. Run with --apply only after reviewing the report.
// This script intentionally cannot target Production.

const admin = require('firebase-admin');
const {
  PRIVATE_FIELDS,
  buildPrivatePropertyData,
  buildPropertyContactInfo,
} = require('../api/_property-private');

const PREVIEW_PROJECT_ID = 'myplotmitra-preview-d8c47';
const PAGE_SIZE = 200;
const BATCH_DOCUMENTS = 150; // 3 writes per property; under Firestore's 500-op limit.
const applyChanges = process.argv.includes('--apply');

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_PREVIEW_B64;
  if (!encoded) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PREVIEW_B64 in this shell first.');
  }
  let account;
  try {
    account = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PREVIEW_B64 is not valid base64 JSON.');
  }
  if (account.project_id !== PREVIEW_PROJECT_ID || !account.private_key || !account.client_email) {
    throw new Error(`Credential project mismatch. Expected ${PREVIEW_PROJECT_ID}.`);
  }
  return account;
}

async function main() {
  const serviceAccount = getServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PREVIEW_PROJECT_ID,
  });

  const db = admin.firestore();
  const properties = db.collection('properties');
  const privateCollection = db.collection('propertyPrivate');
  const contactCollection = db.collection('propertyContactInfo');
  const deleteField = admin.firestore.FieldValue.delete();
  const results = {
    scanned: 0,
    needsMigration: 0,
    wouldMigrate: 0,
    migrated: 0,
    skippedNoPrivateFields: 0,
    skippedMissingOwner: 0,
    conflicts: 0,
  };
  const issueIds = [];
  let cursor = null;
  let batch = db.batch();
  let batchDocumentCount = 0;

  async function commitBatch() {
    if (!applyChanges || batchDocumentCount === 0) return;
    await batch.commit();
    results.migrated += batchDocumentCount;
    batch = db.batch();
    batchDocumentCount = 0;
  }

  while (true) {
    let query = properties.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;

    for (const propertySnap of page.docs) {
      results.scanned += 1;
      const publicData = propertySnap.data() || {};
      const containsPrivateField = PRIVATE_FIELDS.some(field =>
        Object.prototype.hasOwnProperty.call(publicData, field)
      );
      if (!containsPrivateField) {
        results.skippedNoPrivateFields += 1;
        continue;
      }

      results.needsMigration += 1;
      const privateRef = privateCollection.doc(propertySnap.id);
      const contactRef = contactCollection.doc(propertySnap.id);
      const [privateSnap, contactSnap] = await Promise.all([
        privateRef.get(),
        contactRef.get(),
      ]);
      const existingPrivate = privateSnap.exists ? privateSnap.data() || {} : {};

      let privateData;
      try {
        privateData = buildPrivatePropertyData(publicData, existingPrivate);
      } catch (error) {
        if (error.message === 'MISSING_PROPERTY_OWNER') {
          results.skippedMissingOwner += 1;
        } else if (error.message === 'PROPERTY_OWNER_CONFLICT') {
          results.conflicts += 1;
        } else {
          results.conflicts += 1;
        }
        issueIds.push(propertySnap.id);
        continue;
      }

      const contactData = buildPropertyContactInfo({
        ...privateData,
        ...(contactSnap.exists ? contactSnap.data() || {} : {}),
      });
      results.wouldMigrate += 1;

      if (applyChanges) {
        batch.set(privateRef, privateData, { merge: true });
        batch.set(contactRef, contactData, { merge: true });
        const removal = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        for (const field of PRIVATE_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(publicData, field)) {
            removal[field] = deleteField;
          }
        }
        batch.update(propertySnap.ref, removal);
        batchDocumentCount += 1;

        if (batchDocumentCount >= BATCH_DOCUMENTS) await commitBatch();
      }
    }

    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  await commitBatch();

  console.log(JSON.stringify({
    mode: applyChanges ? 'APPLY' : 'DRY_RUN',
    projectId: PREVIEW_PROJECT_ID,
    ...results,
    issuePropertyIds: issueIds,
  }, null, 2));

  if (!applyChanges) {
    console.log('No Firestore documents were changed. Add --apply only after reviewing this report.');
  }
  if (issueIds.length) {
    console.error('Some records need manual ownership review; they were not changed.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error('Legacy property privacy migration failed:', error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  if (admin.apps.length) await admin.app().delete();
});
