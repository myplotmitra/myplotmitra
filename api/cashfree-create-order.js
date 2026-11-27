// POST /api/cashfree-create-order
// Body: { kind, customerPhone, propId? , bannerId? }
// Amounts and purchasable options are always calculated from Firestore here.
const crypto = require('crypto');
const {
  admin, db, cashfreeRequest, roundRupees, sameMoney, checkoutLockRef,
  getCashfreeOrder, getCashfreePaymentAttempts, fulfilCashfreeOrder
} = require('./_cashfree');
const { authenticate } = require('./_r2');
const { getCashfreeCallbackUrls } = require('./_cashfree-callbacks');
const { canUnlockContactFor } = require('./_property-policy');
const { mergePropertyData } = require('./_property-private');
const {
  SOCIAL_PROMOTION_PRICE_PER_PLATFORM,
  normalizeRequestedPlatforms,
  calculateSocialPromotionAmount,
  getUnpaidSocialPromotionPlatforms
} = require('./_social-promotion-policy');

const BADGES = {
  verifiedOwner: { field: 'badgePOwner', fallback: 199 },
  verifiedPhone: { field: 'badgePPhone', fallback: 49 },
  verifiedProperty: { field: 'badgePProperty', fallback: 299 },
  visitPhotos: { field: 'badgePVisit', fallback: 149 },
  location: { field: 'badgePLocation', fallback: 99 }
};

const price = (cfg, field, fallback) => {
  const n = Number(cfg[field]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let payRef = null;
  let reservationCreated = false;
  let callbackUrls = null;
  let rentalDraftId = null;
  let propertyId = null;
  let rentalDraftRef = null;
  try {
    const user = await authenticate(req);
    const body = req.body || {};
    const kind = String(body.kind || '');
    const phone = String(body.customerPhone || '').replace(/\D/g, '').slice(-10);
    if (!['prime', 'flexy', 'featured', 'property_addons', 'banner', 'rental', 'social_promotion'].includes(kind)) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number for payment' });
    }

    const cfgSnap = await db.collection('settings').doc('app').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    let amount = 0;
    let label = '';
    let propId = null;
    let bannerId = null;
    let credits = 0;
    let addons = null;
    let socialPromotionPlatforms = [];
    const socialPromotionUnitPrice = SOCIAL_PROMOTION_PRICE_PER_PLATFORM;

    if (kind === 'prime') {
      amount = price(cfg, 'primePrice', 25);
      label = 'Prime subscription — 30 days';
    } else if (kind === 'flexy') {
      propId = String(body.propId || '').trim();
      if (!propId) return res.status(400).json({ error: 'propId required' });
      const [propSnap, privateSnap, unlockSnap] = await Promise.all([
        db.collection('properties').doc(propId).get(),
        db.collection('propertyPrivate').doc(propId).get(),
        db.collection('unlocks').doc(`${propId}_${user.uid}`).get()
      ]);
      if (!propSnap.exists) return res.status(404).json({ error: 'Property not found' });

      const prop = mergePropertyData(
        propSnap.data(),
        privateSnap.exists ? privateSnap.data() : {}
      );

      if (prop.ownerId === user.uid) return res.status(403).json({ error: 'You cannot unlock your own listing' });
      if (!canUnlockContactFor(prop, user.uid)) return res.status(409).json({ error: 'This listing is not currently available for contact unlock' });
      if (unlockSnap.exists) return res.status(409).json({ error: 'This seller is already unlocked' });
      amount = price(cfg, 'flexyPrice', 10);
      credits = Math.max(1, Math.floor(Number(cfg.flexyCount) || 3));
      label = `${credits} seller contact${credits > 1 ? 's' : ''}`;
    } else if (kind === 'featured' || kind === 'property_addons') {
      propId = String(body.propId || '').trim();
      if (!propId) return res.status(400).json({ error: 'propId required' });
      const [propSnap, privateSnap] = await Promise.all([
        db.collection('properties').doc(propId).get(),
        db.collection('propertyPrivate').doc(propId).get()
      ]);
      if (!propSnap.exists) return res.status(404).json({ error: 'Property not found' });

      const prop = mergePropertyData(
        propSnap.data(),
        privateSnap.exists ? privateSnap.data() : {}
      );

      if (prop.ownerId !== user.uid) return res.status(403).json({ error: 'You can pay only for your own listing' });
        if (kind === 'featured' && prop.status !== 'approved') {
          return res.status(409).json({ error: 'This listing must be approved before purchasing Featured placement' });
        }
      const wantsFeatured = kind === 'featured' || (!!prop.featuredRequested && !prop.featuredPaid && !prop.isFeatured);
      const badgeKeys = kind === 'property_addons'
        ? Object.keys(BADGES).filter(key => prop.badgesRequested && prop.badgesRequested[key] &&
            !(prop.badgesPaid && prop.badgesPaid[key]) && !(prop.badges && prop.badges[key]))
        : [];
      if (kind === 'property_addons') {
        try {
          normalizeRequestedPlatforms(prop.socialPromotionPlatforms || []);
          socialPromotionPlatforms = getUnpaidSocialPromotionPlatforms(prop);
        } catch (_) {
          return res.status(409).json({ error: 'The saved social promotion selection is invalid. Please contact support.' });
        }
      }
      if (kind === 'featured' && (prop.featuredPaid || prop.isFeatured)) {
        return res.status(409).json({ error: 'Featured placement is already paid or active' });
      }
      if (!wantsFeatured && !badgeKeys.length && !socialPromotionPlatforms.length) {
        return res.status(400).json({ error: 'No unpaid Featured, badge or social media options were selected for this listing' });
      }
      addons = { featured: wantsFeatured, badgeKeys };
      if (wantsFeatured) amount += price(cfg, 'featuredPrice', 499);
      for (const key of badgeKeys) amount += price(cfg, BADGES[key].field, BADGES[key].fallback);
      if (socialPromotionPlatforms.length) {
        amount += calculateSocialPromotionAmount(socialPromotionPlatforms);
      }
      label = [
        wantsFeatured ? 'Featured listing' : '',
        ...badgeKeys.map(k => k),
        socialPromotionPlatforms.length ? `Social promotion: ${socialPromotionPlatforms.join(', ')}` : ''
      ].filter(Boolean).join(' + ');
    } else if (kind === 'social_promotion') {
      propId = String(body.propId || '').trim();
      if (!propId || propId.includes('/') || propId.length > 150) {
        return res.status(400).json({ error: 'A valid propId is required' });
      }
      const [propSnap, privateSnap] = await Promise.all([
        db.collection('properties').doc(propId).get(),
        db.collection('propertyPrivate').doc(propId).get()
      ]);
      if (!propSnap.exists) return res.status(404).json({ error: 'Property not found' });
      const prop = mergePropertyData(
        propSnap.data(),
        privateSnap.exists ? privateSnap.data() : {}
      );
      if (String(prop.ownerId || '') !== String(user.uid)) {
        return res.status(403).json({ error: 'You can promote only your own listing' });
      }
      if (!['pending', 'approved'].includes(String(prop.status || '').toLowerCase())) {
        return res.status(409).json({ error: 'Only pending or approved listings can be promoted' });
      }
      try {
        normalizeRequestedPlatforms(prop.socialPromotionPlatforms || []);
        socialPromotionPlatforms = getUnpaidSocialPromotionPlatforms(prop);
      } catch (policyError) {
        return res.status(409).json({ error: 'The saved social promotion selection is invalid. Please contact support.' });
      }
      if (!socialPromotionPlatforms.length) {
        return res.status(409).json({ error: 'No unpaid social media platforms are selected for this property' });
      }
      amount = calculateSocialPromotionAmount(socialPromotionPlatforms);
      label = `Social media promotion — ${socialPromotionPlatforms.join(', ')}`;
    } else if (kind === 'banner') {
      bannerId = String(body.bannerId || '').trim();
      if (!bannerId) return res.status(400).json({ error: 'bannerId required' });
      const bannerSnap = await db.collection('banners').doc(bannerId).get();
      if (!bannerSnap.exists) return res.status(404).json({ error: 'Banner request not found' });
      const banner = bannerSnap.data();
      if (banner.submittedBy !== user.uid) return res.status(403).json({ error: 'You can pay only for your own banner request' });
      if (banner.paymentStatus === 'paid') return res.status(409).json({ error: 'This banner is already paid' });
      if (banner.cashfreeEligible !== true) {
        return res.status(409).json({ error: 'This banner request is not enabled for Cashfree payment' });
      }
      if (banner.status !== 'pending' || banner.active) {
        return res.status(409).json({ error: 'Only pending banner requests can be paid for' });
      }
      const duration = Number(banner.requestedDuration ?? 7);
      if (!Number.isInteger(duration) || ![7, 15, 30].includes(duration)) {
        return res.status(400).json({ error: 'Banner duration must be 7, 15 or 30 days' });
      }
      const durationField = duration === 30 ? 'bannerPrice30' : (duration === 15 ? 'bannerPrice15' : 'bannerPrice7');
      const fallback = duration === 30 ? 1499 : (duration === 15 ? 899 : 499);
      amount = price(cfg, durationField, fallback);
      label = `Sponsored banner — ${duration} days`;
    }

    if (kind === 'rental') {
      rentalDraftId = String(body.rentalDraftId || '').trim();

      if (!rentalDraftId || rentalDraftId.includes('/') || rentalDraftId.length > 150) {
        return res.status(400).json({ error: 'A valid rentalDraftId is required' });
      }

      rentalDraftRef = db.collection('rentalDrafts').doc(rentalDraftId);
      const draftSnap = await rentalDraftRef.get();

      if (!draftSnap.exists) {
        return res.status(404).json({ error: 'Rental draft not found' });
      }

      const draft = draftSnap.data() || {};
      propertyId = String(draft.propertyId || '');

      if (
        String(draft.ownerId || '') !== String(user.uid) ||
        !propertyId ||
        propertyId.includes('/') ||
        draft.status !== 'pending_payment' ||
        !['unpaid', 'creating', 'created'].includes(String(draft.paymentStatus || '')) ||
        !draft.property ||
        draft.property.transactionType !== 'rent'
      ) {
        return res.status(409).json({ error: 'Rental draft ownership or payment status is invalid' });
      }

      const snapshot = draft.pricingSnapshot || {};
      const storedAmount = Number(draft.rentalFeeAmount);

      if (
        !Number.isSafeInteger(storedAmount) ||
        storedAmount < 1 ||
        !sameMoney(snapshot.amount, storedAmount) ||
        String(draft.currency || '') !== 'INR' ||
        String(snapshot.currency || '') !== 'INR' ||
        Number(snapshot.photoCount) !== Number(draft.photoCount) ||
        !Number.isSafeInteger(Number(draft.photoCount)) ||
        Number(draft.photoCount) < 1
      ) {
        return res.status(409).json({ error: 'Rental pricing information is invalid. Please recreate the rental draft.' });
      }

      addons = draft.addons && typeof draft.addons === 'object'
        ? { featured: draft.addons.featured === true, badgeKeys: [] }
        : { featured: false, badgeKeys: [] };
      try {
        socialPromotionPlatforms = normalizeRequestedPlatforms(draft.socialPromotionPlatforms || []);
      } catch (_) {
        return res.status(409).json({ error: 'Rental draft contains invalid social promotion selections.' });
      }
      if (
        Boolean(snapshot.featuredRequested) !== Boolean(addons.featured) ||
        JSON.stringify(snapshot.socialPromotionPlatforms || []) !== JSON.stringify(socialPromotionPlatforms)
      ) {
        return res.status(409).json({ error: 'Rental add-on selections do not match their trusted pricing snapshot.' });
      }
      amount = storedAmount;
      label = [
        `Rental listing — ${Number(draft.photoCount)} photo(s)`,
        addons.featured ? 'Featured listing' : '',
        socialPromotionPlatforms.length ? `Social promotion: ${socialPromotionPlatforms.join(', ')}` : ''
      ].filter(Boolean).join(' + ');
    }

    amount = roundRupees(amount);
    if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ error: 'Payment amount is below the Cashfree minimum of ₹1' });

    const orderId = `MPM_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    payRef = db.collection('payments').doc(orderId);

    // Reserve the exact purchase targets before contacting Cashfree.
    // Featured and Featured add-ons deliberately share the same lock.
    const reservationKeys = [];

    if (kind === 'prime') {
      reservationKeys.push(`prime|${user.uid}`);
    } else if (kind === 'flexy') {
      reservationKeys.push(`flexy|${user.uid}|${propId}`);
    } else if (kind === 'featured' || kind === 'property_addons') {
      if (addons && addons.featured) {
        reservationKeys.push(`featured|${propId}`);
      }
      for (const key of (addons && Array.isArray(addons.badgeKeys) ? addons.badgeKeys : [])) {
        reservationKeys.push(`badge|${propId}|${key}`);
      }
      for (const platform of socialPromotionPlatforms) {
        reservationKeys.push(`social_promotion|${propId}|${platform}`);
      }
    } else if (kind === 'banner') {
      reservationKeys.push(`banner|${bannerId}`);
    } else if (kind === 'social_promotion') {
      for (const platform of socialPromotionPlatforms) {
        reservationKeys.push(`social_promotion|${propId}|${platform}`);
      }
    } else if (kind === 'rental') {
      reservationKeys.push(`rental|${rentalDraftId}`);
      if (addons && addons.featured) reservationKeys.push(`featured|${propertyId}`);
      for (const platform of socialPromotionPlatforms) {
        reservationKeys.push(`social_promotion|${propertyId}|${platform}`);
      }
    }

    if (!reservationKeys.length) {
      return res.status(400).json({ error: 'No valid checkout reservation target' });
    }

    const lockRefs = reservationKeys.map(checkoutLockRef);

    const reservation = await db.runTransaction(async tx => {
      // Read every requested lock before any transaction writes.
      const lockSnaps = await Promise.all(lockRefs.map(ref => tx.get(ref)));
      const rentalDraftSnap = kind === 'rental' ? await tx.get(rentalDraftRef) : null;
      const occupied = lockSnaps.filter(snap => snap.exists);

      let rentalDraft = null;
      if (kind === 'rental') {
        if (!rentalDraftSnap || !rentalDraftSnap.exists) {
          const conflict = new Error('Rental draft no longer exists. Please contact support.');
          conflict.status = 409;
          throw conflict;
        }

        rentalDraft = rentalDraftSnap.data() || {};
        const snapshot = rentalDraft.pricingSnapshot || {};

        if (
          String(rentalDraft.ownerId || '') !== String(user.uid) ||
          String(rentalDraft.propertyId || '') !== String(propertyId) ||
          rentalDraft.status !== 'pending_payment' ||
          !rentalDraft.property ||
          rentalDraft.property.transactionType !== 'rent' ||
          !sameMoney(rentalDraft.rentalFeeAmount, amount) ||
          !sameMoney(snapshot.amount, amount) ||
          String(rentalDraft.currency || '') !== 'INR' ||
          String(snapshot.currency || '') !== 'INR' ||
          Boolean((rentalDraft.addons || {}).featured) !== Boolean((addons || {}).featured) ||
          JSON.stringify(rentalDraft.socialPromotionPlatforms || []) !== JSON.stringify(socialPromotionPlatforms)
        ) {
          const conflict = new Error('Rental draft or saved pricing changed. Please contact support.');
          conflict.status = 409;
          throw conflict;
        }
      }

      if (kind === 'rental' && occupied.length === 0) {
        if (
          String(rentalDraft.paymentStatus || '') !== 'unpaid' ||
          String(rentalDraft.cashfreeOrderId || '')
        ) {
          const conflict = new Error(
            'This rental draft already has a checkout attempt. Please recover the existing payment or contact support.'
          );
          conflict.status = 409;
          throw conflict;
        }
      }

      if (occupied.length) {
        // Partial reservations are ambiguous: never create another order.
        if (occupied.length !== lockRefs.length) {
          const conflict = new Error(
            'An incomplete checkout reservation exists. Do not pay again; contact support.'
          );
          conflict.status = 409;
          throw conflict;
        }

        const lockData = lockSnaps.map(snap => snap.data() || {});
        const orderIds = [...new Set(lockData.map(item => String(item.orderId || '')))];

        if (orderIds.length !== 1 || !orderIds[0]) {
          const conflict = new Error(
            'Checkout reservations do not belong to one valid order. Contact support.'
          );
          conflict.status = 409;
          throw conflict;
        }

        for (let i = 0; i < lockData.length; i++) {
          if (
            lockData[i].key !== reservationKeys[i] ||
            String(lockData[i].uid || '') !== String(user.uid) ||
            String(lockData[i].kind || '') !== kind
          ) {
            const conflict = new Error(
              'Checkout reservation details do not match this purchase. Contact support.'
            );
            conflict.status = 409;
            throw conflict;
          }
        }

        const existingOrderId = orderIds[0];

        if (kind === 'rental') {
          if (
            String(rentalDraft.cashfreeOrderId || '') !== existingOrderId ||
            !['creating', 'created'].includes(String(rentalDraft.paymentStatus || ''))
          ) {
            const conflict = new Error('Rental draft does not match its existing checkout reservation. Contact support.');
            conflict.status = 409;
            throw conflict;
          }
        }

        const existingRef = db.collection('payments').doc(existingOrderId);
        const existingSnap = await tx.get(existingRef);

        if (!existingSnap.exists) {
          const conflict = new Error(
            'The existing checkout record is missing. Contact support before paying again.'
          );
          conflict.status = 409;
          throw conflict;
        }

        const existing = existingSnap.data() || {};
        const storedKeys = Array.isArray(existing.reservationKeys)
          ? existing.reservationKeys.slice().sort()
          : [];
        const requestedKeys = reservationKeys.slice().sort();

        const matches =
          existing.gateway === 'cashfree' &&
          String(existing.orderId || '') === existingOrderId &&
          String(existing.uid || '') === String(user.uid) &&
          String(existing.kind || '') === kind &&
          String(existing.propId || '') === String(propId || '') &&
          String(existing.bannerId || '') === String(bannerId || '') &&
          String(existing.rentalDraftId || '') === String(rentalDraftId || '') &&
          String(existing.propertyId || '') === String(propertyId || '') &&
          sameMoney(existing.amount, amount) &&
          String(existing.currency || '') === 'INR' &&
          Number(existing.credits || 0) === Number(credits || 0) &&
          JSON.stringify(existing.addons || null) === JSON.stringify(addons || null) &&
          JSON.stringify(existing.socialPromotionPlatforms || []) === JSON.stringify(socialPromotionPlatforms || []) &&
          Number(existing.socialPromotionUnitPrice || 0) === Number(socialPromotionPlatforms.length ? socialPromotionUnitPrice : 0) &&
          JSON.stringify(storedKeys) === JSON.stringify(requestedKeys);

        if (!matches) {
          const conflict = new Error(
            'The existing checkout belongs to a different purchase configuration. Contact support.'
          );
          conflict.status = 409;
          throw conflict;
        }

        return { existingOrderId, existingPayment: existing };
      }

      // Validate callbacks only for a new order, before creating payment or locks.
      callbackUrls = getCashfreeCallbackUrls();

      tx.create(payRef, {
        gateway: 'cashfree',
        kind,
        orderId,
        uid: user.uid,
        propId,
        bannerId,
        rentalDraftId,
        propertyId,
        credits,
        addons,
        socialPromotionPlatforms,
        socialPromotionUnitPrice: socialPromotionPlatforms.length ? socialPromotionUnitPrice : null,
        reservationKeys,
        amount,
        currency: 'INR',
        status: 'creating',
        label,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      lockRefs.forEach((lockRef, index) => {
        tx.create(lockRef, {
          key: reservationKeys[index],
          orderId,
          uid: user.uid,
          kind,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      if (kind === 'rental') {
        tx.update(rentalDraftRef, {
          paymentStatus: 'creating',
          cashfreeOrderId: orderId,
          paymentGateway: 'cashfree',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return { created: true };
    });

    if (reservation.existingOrderId) {
      const existingOrderId = reservation.existingOrderId;
      const existingPay = reservation.existingPayment;

      // A successful payment is already fulfilled. Run the idempotent
      // helper to release only any stale locks still owned by this order.
      if (existingPay.status === 'success') {
        const fulfilled = await fulfilCashfreeOrder(existingOrderId, null);

        return res.status(200).json({
          ...fulfilled,
          success: true,
          alreadyPaid: true,
          orderId: existingOrderId,
          creditsLeft: existingPay.creditsLeft
        });
      }

      if (!['creating', 'created'].includes(existingPay.status)) {
        const conflict = new Error(
          'The existing checkout is not in a recoverable state. Do not pay again; contact support.'
        );
        conflict.status = 409;
        throw conflict;
      }

      // Reconcile against Cashfree's server-side order and payment records.
      const cfOrder = await getCashfreeOrder(existingOrderId);

      if (
        !cfOrder ||
        String(cfOrder.order_id || '') !== existingOrderId ||
        !sameMoney(cfOrder.order_amount, existingPay.amount) ||
        String(cfOrder.order_currency || '') !== 'INR'
      ) {
        const conflict = new Error(
          'Cashfree order details do not match the stored purchase. Contact support.'
        );
        conflict.status = 409;
        throw conflict;
      }

      const attempts = await getCashfreePaymentAttempts(existingOrderId);
      const successfulAttempt = attempts.find(attempt =>
        attempt &&
        attempt.payment_status === 'SUCCESS' &&
        String(attempt.order_id || '') === existingOrderId
      );

      if (successfulAttempt) {
        const fulfilled = await fulfilCashfreeOrder(existingOrderId, successfulAttempt);

        return res.status(200).json({
          ...fulfilled,
          success: true,
          alreadyPaid: true,
          orderId: existingOrderId
        });
      }

      if (String(cfOrder.order_status || '').toUpperCase() !== 'ACTIVE') {
        const conflict = new Error(
          'The existing Cashfree order is not active and no verified successful payment was found. Do not pay again; contact support.'
        );
        conflict.status = 409;
        throw conflict;
      }

      // Pending or unknown attempts must never trigger another checkout.
      if (attempts.some(attempt =>
        !attempt || String(attempt.payment_status || '').toUpperCase() !== 'FAILED'
      )) {
        const conflict = new Error(
          'A payment attempt is still pending or has an unknown status. Do not pay again; check the order status later.'
        );
        conflict.status = 409;
        throw conflict;
      }

      const session = String(cfOrder.payment_session_id || '');
      const storedSession = String(existingPay.paymentSessionId || '');

      if (!session || (storedSession && storedSession !== session)) {
        const conflict = new Error(
          'Cashfree payment session is missing or does not match the stored order. Contact support.'
        );
        conflict.status = 409;
        throw conflict;
      }

      const expiryText = String(cfOrder.order_expiry_time || '');
      const expiryMs = Date.parse(expiryText);

      if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
        const conflict = new Error(
          'The existing Cashfree checkout has expired. Its reservation is retained for reconciliation; contact support.'
        );
        conflict.status = 409;
        throw conflict;
      }

      // Recover a session when the original order-creation request timed out.
      await db.collection('payments').doc(existingOrderId).update({
        status: 'created',
        paymentSessionId: session,
        cfOrderId: String(cfOrder.cf_order_id || existingPay.cfOrderId || ''),
        orderExpiryTime: expiryText,
        recoveredAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (kind === 'rental') {
        await rentalDraftRef.update({
          paymentStatus: 'created',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return res.status(200).json({
        success: true,
        orderId: existingOrderId,
        paymentSessionId: session,
        amount: existingPay.amount,
        currency: 'INR',
        label: existingPay.label || label,
        kind,
        recovered: true,
        environment:
          String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ||
          String(process.env.CASHFREE_ENV || '').toLowerCase() === 'prod'
            ? 'PRODUCTION'
            : 'SANDBOX'
      });
    }

    reservationCreated = true;

    const returnUrl = callbackUrls.returnUrl;
    const notifyUrl = callbackUrls.notifyUrl;
    const safeCustomerId = `mpm_${String(user.uid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
    const customerName = String(user.name || (user.email ? user.email.split('@')[0] : 'MyPlotMitra User')).slice(0, 100);
    const customerDetails = {
      customer_id: safeCustomerId,
      customer_phone: phone,
      customer_name: customerName
    };
    if (user.email) customerDetails.customer_email = String(user.email).slice(0, 100);

    const cfOrder = await cashfreeRequest('/orders', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      body: {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: customerDetails,
        order_meta: { return_url: returnUrl, notify_url: notifyUrl },
        order_note: `MyPlotMitra: ${label}`.slice(0, 200)
      }
    });
    if (!cfOrder || !cfOrder.payment_session_id || cfOrder.order_id !== orderId) {
      throw new Error('Cashfree did not return a valid payment session');
    }

    await payRef.update({
      status: 'created',
      paymentSessionId: cfOrder.payment_session_id,
      cfOrderId: String(cfOrder.cf_order_id || ''),
      orderExpiryTime: cfOrder.order_expiry_time || null
    });

    if (kind === 'rental') {
      await rentalDraftRef.update({
        paymentStatus: 'created',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      amount,
      currency: 'INR',
      label,
      kind,
      environment: String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ||
        String(process.env.CASHFREE_ENV || '').toLowerCase() === 'prod' ? 'PRODUCTION' : 'SANDBOX'
    });
  } catch (error) {
    // A network/API error does not prove Cashfree rejected the order.
    // Keep the payment in 'creating' and retain its reservation for reconciliation.
    if (reservationCreated && payRef) {
      try {
        await payRef.set({
          createError: String(error.message || 'Cashfree order creation outcome is uncertain').slice(0, 220),
          createErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (_) {}
    }
    const status = Number(error.status) || (error.message === 'Authentication required' || /login session|Authentication required/i.test(error.message) ? 401 : 500);
    console.error('cashfree-create-order:', error.message || 'Unknown error');
    return res.status(status).json({ error: status === 401 ? 'Please sign in again' : (error.status ? error.message : 'Could not create Cashfree order') });
  }
};
