const { mergePropertyData } = require('./_property-private');
const { buildCashfreeFulfilmentResult } = require('./_cashfree-fulfilment-result');
// Shared Cashfree Payment Gateway utilities for MyPlotMitra.
// Uses the existing Firebase Admin initialization in ./_r2.js.
const crypto = require('crypto');
const {
  verifyCashfreeWebhookSignature,
  isSuccessfulCashfreePayment,
  validateSuccessfulCashfreePayment
} = require('./_cashfree-policy');
const { admin } = require('./_r2');
const { canUnlockContactFor } = require('./_property-policy');
const { buildPropertyCreateDocuments } = require('./_property-create-policy');
const {
  isHeldPropertyUpload,
  propertyUploadDocumentId
} = require('./_property-upload-registry');

const db = admin.firestore();

function cashfreeConfig() {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const deploymentEnvironment = String(
    process.env.VERCEL_ENV || 'development'
  ).trim().toLowerCase();

  if (!['development', 'preview', 'production'].includes(deploymentEnvironment)) {
    throw new Error('Unsupported deployment environment for Cashfree');
  }

  const rawEnv = String(process.env.CASHFREE_ENV || '').trim().toLowerCase();

  let environment;

  if (rawEnv === 'sandbox') {
    environment = 'sandbox';
  } else if (rawEnv === 'production' || rawEnv === 'prod') {
    environment = 'production';
  } else {
    throw new Error('CASHFREE_ENV must be explicitly set to sandbox or production');
  }

  if (deploymentEnvironment === 'production' && environment !== 'production') {
    throw new Error('Production deployment requires Cashfree Production environment');
  }

  if (deploymentEnvironment !== 'production' && environment !== 'sandbox') {
    throw new Error('Preview and local development require Cashfree Sandbox environment');
  }

  if (!appId || !secretKey) {
    throw new Error('Cashfree server credentials are not configured');
  }
  return {
    appId,
    secretKey,
    environment,
    apiVersion: process.env.CASHFREE_API_VERSION || '2025-01-01',
    baseUrl: environment === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'
  };
}

async function cashfreeRequest(path, options = {}) {
  const cfg = cashfreeConfig();
  const headers = {
    'Content-Type': 'application/json',
    'x-client-id': cfg.appId,
    'x-client-secret': cfg.secretKey,
    'x-api-version': cfg.apiVersion
  };
  if (options.idempotencyKey) headers['x-idempotency-key'] = options.idempotencyKey;
  const response = await fetch(cfg.baseUrl + path, {
    method: options.method || 'GET',
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    const detail = data && (data.message || data.code || data.type);
    const error = new Error(`Cashfree API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    error.status = 502;
    throw error;
  }
  return data;
}

function roundRupees(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sameMoney(a, b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
    Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

// Deterministic document ID; the raw reservation key is not used as a path.
function checkoutLockRef(key) {
  const value = String(key || '');
  if (!value) throw new Error('Checkout reservation key is missing');
  const id = crypto.createHash('sha256').update(value).digest('hex');
  return db.collection('checkoutLocks').doc(id);
}

function verifyWebhookSignature(rawBody, timestamp, signature) {
  const cfg = cashfreeConfig();

  return verifyCashfreeWebhookSignature(
    rawBody,
    timestamp,
    signature,
    cfg.secretKey
  );
}

function paymentList(response) {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
}

async function getCashfreeOrder(orderId) {
  if (!orderId) throw new Error('Cashfree order ID is required');
  return cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`);
}

async function getCashfreePaymentAttempts(orderId) {
  if (!orderId) throw new Error('Cashfree order ID is required');
  const result = await cashfreeRequest(
    `/orders/${encodeURIComponent(orderId)}/payments`
  );
  return paymentList(result);
}

async function getSuccessfulPayment(orderId, expectedPaymentId) {
  const result = await cashfreeRequest(`/orders/${encodeURIComponent(orderId)}/payments`);
  const attempts = paymentList(result);
  return attempts.find(p => isSuccessfulCashfreePayment(p, orderId, expectedPaymentId)) || null;
}

// This function is called only after Cashfree's server-side Payments API has
// returned a SUCCESS attempt for the exact stored order.
async function fulfilCashfreeOrder(orderId, payment) {
  const paymentRef = db.collection('payments').doc(String(orderId));
  return db.runTransaction(async tx => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) throw new Error('Cashfree order is not recorded in MyPlotMitra');
    const pay = paymentSnap.data();
    if (pay.gateway !== 'cashfree' || String(pay.orderId) !== String(orderId)) {
      throw new Error('Cashfree order record mismatch');
    }
    const reservationKeys = Array.isArray(pay.reservationKeys)
      ? pay.reservationKeys.filter(key => typeof key === 'string' && key.length > 0)
      : [];
    const lockRefs = reservationKeys.map(checkoutLockRef);

    // Read all locks before any writes in this transaction.
    const lockSnaps = await Promise.all(lockRefs.map(ref => tx.get(ref)));

    if (pay.status === 'success') {
      lockSnaps.forEach((snap, index) => {
        if (snap.exists && String(snap.data().orderId) === String(orderId)) {
          tx.delete(lockRefs[index]);
        }
      });
      return {
        success: true,
        alreadyProcessed: true,
        kind: pay.kind,
        propId: pay.propId || pay.propertyId || null,
        propertyId: pay.propertyId || pay.propId || null,
        needsReview: pay.fulfilmentStatus === 'needs_review'
      };
    }
    validateSuccessfulCashfreePayment(
      payment,
      orderId,
      pay.amount,
      pay.currency || 'INR'
    );

    const uid = pay.uid;
    const userRef = db.collection('users').doc(uid);
    const paidAt = admin.firestore.FieldValue.serverTimestamp();
    const paymentUpdate = {
      status: 'success',
      paymentStatus: 'paid',
      cfPaymentId: String(payment.cf_payment_id),
      paymentMessage: payment.payment_message || 'Transaction successful',
      paymentTime: payment.payment_completion_time || payment.payment_time || null,
      paidAt,
      fulfilmentStatus: 'complete'
    };


    if (pay.kind === 'rental') {
      const rentalDraftId = String(pay.rentalDraftId || '');
      const propertyId = String(pay.propertyId || '');
      let reviewReason = '';

      let draftRef = null;
      let draftSnap = null;
      let draft = null;

      if (
        !rentalDraftId ||
        rentalDraftId.includes('/') ||
        !propertyId ||
        propertyId.includes('/') ||
        !uid
      ) {
        reviewReason = 'Rental payment record is missing valid draft or property identifiers';
      }

      if (!reviewReason) {
        draftRef = db.collection('rentalDrafts').doc(rentalDraftId);
        draftSnap = await tx.get(draftRef);

        if (!draftSnap.exists) {
          reviewReason = 'Rental draft is missing after successful payment';
        } else {
          draft = draftSnap.data() || {};

          if (
            String(draft.ownerId || '') !== String(uid) ||
            String(draft.propertyId || '') !== propertyId ||
            String(draft.cashfreeOrderId || '') !== String(orderId) ||
            !sameMoney(draft.rentalFeeAmount, pay.amount) ||
            String(draft.currency || '') !== 'INR' ||
            !draft.pricingSnapshot ||
            !sameMoney(draft.pricingSnapshot.amount, pay.amount) ||
            String(draft.pricingSnapshot.currency || '') !== 'INR' ||
            Number(draft.pricingSnapshot.photoCount) !== Number(draft.photoCount) ||
            Boolean((draft.addons || {}).featured) !== Boolean((pay.addons || {}).featured) ||
            JSON.stringify(draft.socialPromotionPlatforms || []) !== JSON.stringify(pay.socialPromotionPlatforms || []) ||
            draft.status !== 'pending_payment' ||
            !['creating', 'created'].includes(String(draft.paymentStatus || '')) ||
            !draft.property ||
            draft.property.transactionType !== 'rent'
          ) {
            reviewReason = 'Rental draft ownership, order, or status does not match the payment';
          }
        }
      }

      let photoKeys = [];
      let uploadRefs = [];

      if (!reviewReason) {
        if (
          !Array.isArray(draft.photoKeys) ||
          !Number.isSafeInteger(draft.rentalMaxPhotos) ||
          draft.rentalMaxPhotos < 1 || draft.rentalMaxPhotos > 100 ||
          draft.photoKeys.length > draft.rentalMaxPhotos ||
          Number(draft.photoCount) !== draft.photoKeys.length ||
          new Set(draft.photoKeys).size !== draft.photoKeys.length
        ) {
          reviewReason = 'Rental draft photo list is invalid';
        } else {
          photoKeys = draft.photoKeys.slice();

          for (const key of photoKeys) {
            const uploadId = propertyUploadDocumentId(key);

            if (!uploadId) {
              reviewReason = 'Rental draft contains an invalid image key';
              break;
            }

            uploadRefs.push({
              key,
              ref: db.collection('propertyUploads').doc(uploadId)
            });
          }
        }
      }

      let propertyRef = null;
      let privateRef = null;
      let contactRef = null;
      let uploadSnaps = [];

      if (!reviewReason) {
        propertyRef = db.collection('properties').doc(propertyId);
        privateRef = db.collection('propertyPrivate').doc(propertyId);
        contactRef = db.collection('propertyContactInfo').doc(propertyId);

        // Read all publication targets and held uploads before any writes.
        const snapshots = await Promise.all([
          tx.get(propertyRef),
          tx.get(privateRef),
          tx.get(contactRef),
          ...uploadRefs.map(item => tx.get(item.ref))
        ]);

        const propertySnap = snapshots[0];
        const privateSnap = snapshots[1];
        const contactSnap = snapshots[2];
        uploadSnaps = snapshots.slice(3);

        if (
          propertySnap.exists ||
          privateSnap.exists ||
          contactSnap.exists
        ) {
          reviewReason = 'Rental property publication target already exists';
        }

        if (!reviewReason) {
          for (let i = 0; i < uploadRefs.length; i++) {
            const snap = uploadSnaps[i];

            if (
              !snap.exists ||
              !isHeldPropertyUpload(
                snap.data() || {},
                uid,
                uploadRefs[i].key,
                rentalDraftId
              )
            ) {
              reviewReason = 'A rental image is missing or is no longer held by this draft';
              break;
            }
          }
        }
      }

      let documents = null;

      if (!reviewReason) {
        try {
          documents = buildPropertyCreateDocuments({
            normalized: {
              publicData: draft.property,
              sellerPhone: draft.sellerPhone,
              photoKeys
            },
            owner: {
              uid,
              email: draft.ownerEmail,
              displayName: draft.ownerName
            },
            publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || ''
          });
        } catch (error) {
          reviewReason = 'Rental property data could not be validated for publication';
        }
      }

      if (reviewReason) {
        paymentUpdate.fulfilmentStatus = 'needs_review';
        paymentUpdate.fulfilmentNote = reviewReason;
        paymentUpdate.rentalDraftId = rentalDraftId || null;
        paymentUpdate.propId = propertyId || null;
        paymentUpdate.propertyId = propertyId || null;

        // Update the draft only when its owner and order identity match.
        // Do not alter held uploads or create a partial property.
        if (
          draftRef &&
          draftSnap &&
          draftSnap.exists &&
          draft &&
          String(draft.ownerId || '') === String(uid) &&
          String(draft.cashfreeOrderId || '') === String(orderId)
        ) {
          tx.update(draftRef, {
            status: 'needs_review',
            paymentStatus: 'paid',
            paymentGateway: 'cashfree',
            paymentOrderId: String(orderId),
            paymentPaidAt: paidAt,
            updatedAt: paidAt
          });
        }
      } else {
        const rentalPropertyData = {
          ...documents.publicData,
          createdAt: paidAt,
          updatedAt: paidAt
        };
        if (pay.addons && pay.addons.featured === true) {
          rentalPropertyData.featuredRequested = true;
          rentalPropertyData.featuredPaid = true;
          rentalPropertyData.isFeatured = true;
          rentalPropertyData.featuredPaymentOrderId = String(orderId);
          rentalPropertyData.featuredPaidAt = paidAt;
        }
        const paidRentalPlatforms = Array.isArray(pay.socialPromotionPlatforms)
          ? pay.socialPromotionPlatforms
          : [];
        if (paidRentalPlatforms.length) {
          const promotionData = { ...(rentalPropertyData.socialPromotions || {}) };
          for (const platform of paidRentalPlatforms) {
            const previous = promotionData[platform] && typeof promotionData[platform] === 'object'
              ? promotionData[platform]
              : {};
            promotionData[platform] = {
              ...previous,
              paymentStatus: 'paid',
              status: 'awaiting_publication',
              published: false,
              paymentOrderId: String(orderId),
              paidAt
            };
          }
          rentalPropertyData.socialPromotions = promotionData;
        }
        tx.create(propertyRef, rentalPropertyData);

        tx.create(privateRef, documents.privateData);
        tx.create(contactRef, documents.contactInfo);

        for (const upload of uploadRefs) {
          tx.update(upload.ref, {
            status: 'attached',
            propertyId,
            attachedAt: paidAt,
            rentalDraftId: admin.firestore.FieldValue.delete(),
            heldAt: admin.firestore.FieldValue.delete(),
            heldExpiresAt: admin.firestore.FieldValue.delete(),
            expiresAt: admin.firestore.FieldValue.delete()
          });
        }

        tx.update(draftRef, {
          status: 'completed',
          paymentStatus: 'paid',
          paymentGateway: 'cashfree',
          paymentOrderId: String(orderId),
          paymentPaidAt: paidAt,
          completedAt: paidAt,
          updatedAt: paidAt
        });

        paymentUpdate.rentalDraftId = rentalDraftId;
        paymentUpdate.propId = propertyId;
        paymentUpdate.propertyId = propertyId;
        paymentUpdate.addons = pay.addons || { featured: false, badgeKeys: [] };
        paymentUpdate.socialPromotionPlatforms = paidRentalPlatforms;
      }
    } else if (pay.kind === 'prime') {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const expiry = userData.premiumUntil;
      const currentExpiryMs = expiry && typeof expiry.toMillis === 'function'
        ? expiry.toMillis()
        : (expiry instanceof Date ? expiry.getTime() : (Number(expiry) || 0));
      const newExpiry = new Date(Math.max(Date.now(), currentExpiryMs) + 30 * 86400000);
      tx.set(userRef, { premiumUntil: newExpiry }, { merge: true });
      tx.set(db.collection('subRequests').doc(uid), {
        uid,
        status: 'paid',
        paymentStatus: 'paid',
        gateway: 'cashfree',
        orderId: String(orderId),
        paidAt
      }, { merge: true });
    } else if (pay.kind === 'flexy') {
      const unlockRef = db.collection('unlocks').doc(`${pay.propId}_${uid}`);
      const [userSnap, unlockSnap, propSnap, privateSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(unlockRef),
        tx.get(db.collection('properties').doc(String(pay.propId))),
        tx.get(db.collection('propertyPrivate').doc(String(pay.propId)))
      ]);
      const currentCredits = Number(userSnap.exists && userSnap.data().contactCredits) || 0;
      const credits = Math.max(1, Number(pay.credits) || 1);
      // If the user unlocked this listing while checkout was open, preserve the
      // entire paid bundle as credits rather than consuming a second credit.
      const property = propSnap.exists
        ? mergePropertyData(
            propSnap.data(),
            privateSnap.exists ? privateSnap.data() : {}
          )
        : null;

      const canUnlockNow = !unlockSnap.exists &&
          canUnlockContactFor(property, uid);
      const creditsLeft = currentCredits + credits - (canUnlockNow ? 1 : 0);
      tx.set(userRef, { contactCredits: creditsLeft }, { merge: true });
      if (canUnlockNow) {
        tx.set(unlockRef, {
          propertyId: String(pay.propId), buyerId: uid,
          orderId: String(orderId), paymentId: String(payment.cf_payment_id),
          via: 'cashfree', createdAt: paidAt
        });
      }
      paymentUpdate.creditsLeft = creditsLeft;
      paymentUpdate.propId = String(pay.propId);
    } else if (pay.kind === 'featured' || pay.kind === 'property_addons') {
      const propRef = db.collection('properties').doc(String(pay.propId || ''));
      const privateRef = db.collection('propertyPrivate').doc(String(pay.propId || ''));

      const [propSnap, privateSnap] = await Promise.all([
        tx.get(propRef),
        tx.get(privateRef)
      ]);

      const property = propSnap.exists
        ? mergePropertyData(
            propSnap.data(),
            privateSnap.exists ? privateSnap.data() : {}
          )
        : null;

      const addons = pay.kind === 'featured'
        ? { featured: true, badgeKeys: [] }
        : (pay.addons || { featured: false, badgeKeys: [] });
      const paidPlatforms = Array.isArray(pay.socialPromotionPlatforms)
        ? pay.socialPromotionPlatforms
        : [];
      const promotions = property && property.socialPromotions && typeof property.socialPromotions === 'object'
        ? property.socialPromotions
        : {};
      const invalidPlatforms = paidPlatforms.some(platform =>
        !['youtube', 'facebook', 'instagram'].includes(platform) ||
        !Array.isArray(property && property.socialPromotionPlatforms) ||
        !property.socialPromotionPlatforms.includes(platform)
      );
      const alreadyPaidPlatforms = paidPlatforms.some(platform => {
        const item = promotions[platform] && typeof promotions[platform] === 'object'
          ? promotions[platform]
          : {};
        return item.paymentStatus === 'paid' || item.published === true;
      });

      if (!propSnap.exists || property.ownerId !== uid) {
        paymentUpdate.fulfilmentStatus = 'needs_review';
        paymentUpdate.fulfilmentNote = 'Property missing or owner mismatch after successful payment';
      } else if (invalidPlatforms || alreadyPaidPlatforms) {
        paymentUpdate.fulfilmentStatus = 'needs_review';
        paymentUpdate.fulfilmentNote = invalidPlatforms
          ? 'Social promotion platform selection does not match the saved property'
          : 'A selected social platform was already paid or published';
      } else {
        const propUpdate = { updatedAt: paidAt };
        if (addons.featured) {
          propUpdate.featuredRequested = true;
          propUpdate.featuredPaid = true;
          propUpdate.isFeatured = true;
          propUpdate.featuredPaymentOrderId = String(orderId);
          propUpdate.featuredPaidAt = paidAt;
        }
        for (const key of (Array.isArray(addons.badgeKeys) ? addons.badgeKeys : [])) {
          if (['verifiedOwner', 'verifiedPhone', 'verifiedProperty', 'visitPhotos', 'location'].includes(key)) {
            propUpdate[`badgesPaid.${key}`] = true;
            propUpdate.badgesPaymentOrderId = String(orderId);
          }
        }
        for (const platform of paidPlatforms) {
          propUpdate[`socialPromotions.${platform}.paymentStatus`] = 'paid';
          propUpdate[`socialPromotions.${platform}.status`] = 'awaiting_publication';
          propUpdate[`socialPromotions.${platform}.published`] = false;
          propUpdate[`socialPromotions.${platform}.paymentOrderId`] = String(orderId);
          propUpdate[`socialPromotions.${platform}.paidAt`] = paidAt;
        }
        tx.update(propRef, propUpdate);
      }
      paymentUpdate.propId = String(pay.propId || '');
      paymentUpdate.addons = addons;
      paymentUpdate.socialPromotionPlatforms = paidPlatforms;
    } else if (pay.kind === 'social_promotion') {
      const propId = String(pay.propId || '');
      const platforms = Array.isArray(pay.socialPromotionPlatforms)
        ? [...new Set(pay.socialPromotionPlatforms.map(value => String(value || '').toLowerCase()))]
        : [];
      const allowedPlatforms = ['youtube', 'facebook', 'instagram'];
      const propRef = db.collection('properties').doc(propId);
      const privateRef = db.collection('propertyPrivate').doc(propId);
      const [propSnap, privateSnap] = await Promise.all([
        tx.get(propRef),
        tx.get(privateRef)
      ]);
      const property = propSnap.exists
        ? mergePropertyData(propSnap.data(), privateSnap.exists ? privateSnap.data() : {})
        : null;
      const requested = property && Array.isArray(property.socialPromotionPlatforms)
        ? property.socialPromotionPlatforms.map(value => String(value || '').toLowerCase())
        : [];
      const promotions = property && property.socialPromotions && typeof property.socialPromotions === 'object'
        ? property.socialPromotions
        : {};
      const invalidTargets = !propSnap.exists || !uid || !propId ||
        property.ownerId !== uid || !platforms.length ||
        platforms.some(platform => !allowedPlatforms.includes(platform) || !requested.includes(platform));
      const alreadyPaidOrPublished = platforms.some(platform => {
        const item = promotions[platform] && typeof promotions[platform] === 'object'
          ? promotions[platform]
          : {};
        return item.paymentStatus === 'paid' || item.published === true;
      });

      if (invalidTargets || alreadyPaidOrPublished) {
        paymentUpdate.fulfilmentStatus = 'needs_review';
        paymentUpdate.fulfilmentNote = invalidTargets
          ? 'Social promotion property ownership or platform selection mismatch after payment'
          : 'A social promotion platform was already paid or published when this order completed';
      } else {
        const propUpdate = { updatedAt: paidAt };
        for (const platform of platforms) {
          propUpdate[`socialPromotions.${platform}.paymentStatus`] = 'paid';
          propUpdate[`socialPromotions.${platform}.status`] = 'awaiting_publication';
          propUpdate[`socialPromotions.${platform}.published`] = false;
          propUpdate[`socialPromotions.${platform}.paymentOrderId`] = String(orderId);
          propUpdate[`socialPromotions.${platform}.paidAt`] = paidAt;
        }
        tx.update(propRef, propUpdate);
      }
      paymentUpdate.propId = propId;
      paymentUpdate.socialPromotionPlatforms = platforms;
    } else if (pay.kind === 'banner') {
      const bannerRef = db.collection('banners').doc(String(pay.bannerId || ''));
      const bannerSnap = await tx.get(bannerRef);
      if (!bannerSnap.exists || bannerSnap.data().submittedBy !== uid) {
        paymentUpdate.fulfilmentStatus = 'needs_review';
        paymentUpdate.fulfilmentNote = 'Banner missing or submitter mismatch after successful payment';
      } else {
        tx.update(bannerRef, {
          paymentStatus: 'paid',
          paymentGateway: 'cashfree',
          paymentOrderId: String(orderId),
          paymentPaidAt: paidAt,
          updatedAt: paidAt
        });
      }
      paymentUpdate.bannerId = String(pay.bannerId || '');
    } else {
      throw new Error('Unsupported Cashfree payment type in stored order');
    }

    // Release only reservations that still belong to this exact order.
    // This is atomic with successful fulfilment and payment status update.
    lockSnaps.forEach((snap, index) => {
      if (snap.exists && String(snap.data().orderId) === String(orderId)) {
        tx.delete(lockRefs[index]);
      }
    });

    tx.update(paymentRef, paymentUpdate);
    return buildCashfreeFulfilmentResult(pay, paymentUpdate);
  });
}

module.exports = {
  admin,
  db,
  cashfreeConfig,
  cashfreeRequest,
  roundRupees,
  sameMoney,
  checkoutLockRef,
  verifyWebhookSignature,
  getCashfreeOrder,
  getCashfreePaymentAttempts,
  getSuccessfulPayment,
  fulfilCashfreeOrder
};
