'use strict';

const { admin, authenticate } = require('./_r2');
const { buildMyPropertyData } = require('./_my-property-data');

async function getInChunks(db, refs, size = 100) {
  const result = [];
  for (let i = 0; i < refs.length; i += size) {
    const snapshots = await db.getAll(...refs.slice(i, i + size));
    result.push(...snapshots);
  }
  return result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const actor = await authenticate(req);
    const db = admin.firestore();
    const uid = actor.uid;

    const [privateOwned, legacyOwned] = await Promise.all([
      db.collection('propertyPrivate').where('ownerId', '==', uid).get(),
      db.collection('properties').where('ownerId', '==', uid).get()
    ]);

    const privateById = new Map(
      privateOwned.docs.map(doc => [doc.id, doc.data() || {}])
    );

    const candidateIds = new Set([
      ...privateOwned.docs.map(doc => doc.id),
      ...legacyOwned.docs.map(doc => doc.id)
    ]);

    const legacyIds = legacyOwned.docs
      .map(doc => doc.id)
      .filter(id => !privateById.has(id));

    // Check private ownership records for legacy-query results. A private
    // record always wins over a stale public ownerId.
    const legacyPrivateSnaps = legacyIds.length
      ? await getInChunks(
          db,
          legacyIds.map(id => db.collection('propertyPrivate').doc(id))
        )
      : [];

    const privateExistsById = new Map(
      legacyPrivateSnaps.map(snap => [snap.id, snap.exists ? snap.data() || {} : null])
    );

    const allowedIds = new Set(privateById.keys());

    for (const doc of legacyOwned.docs) {
      const privateData = privateExistsById.has(doc.id)
        ? privateExistsById.get(doc.id)
        : null;

      if (privateData === null) {
        allowedIds.add(doc.id);
      } else if (String(privateData.ownerId || '') === uid) {
        allowedIds.add(doc.id);
        privateById.set(doc.id, privateData);
      }
    }

    const ids = [...candidateIds].filter(id => allowedIds.has(id));
    const propertySnaps = ids.length
      ? await getInChunks(
          db,
          ids.map(id => db.collection('properties').doc(id))
        )
      : [];

    const properties = propertySnaps
      .filter(snap => snap.exists)
      .map(snap => buildMyPropertyData(
        snap.id,
        snap.data() || {},
        privateById.has(snap.id) ? privateById.get(snap.id) : null,
        uid
      ))
      .filter(Boolean)
      .sort((a, b) => {
        const time = value => value && typeof value.toMillis === 'function'
          ? value.toMillis()
          : value && value.seconds
            ? value.seconds * 1000
            : 0;
        return time(b.createdAt) - time(a.createdAt);
      });

    return res.status(200).json({ success: true, properties });
  } catch (error) {
    const status = Number(error.status) ||
      (/Authentication required|login session|Invalid or expired/i.test(
        error.message || ''
      ) ? 401 : 500);

    if (status >= 500) {
      console.error('my-properties:', error.message || error);
    }

    return res.status(status).json({
      error: status === 401
        ? 'Please sign in again'
        : status < 500
          ? error.message
          : 'Could not load your properties'
    });
  }
};
