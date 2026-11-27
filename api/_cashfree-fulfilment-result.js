'use strict';

/**
 * Build the client-safe result returned after transactional payment fulfilment.
 * Rental orders know their property ID only after the paid rental draft is
 * published, so prefer the fulfilment update over the original order record.
 */
function buildCashfreeFulfilmentResult(pay, paymentUpdate) {
  const source = pay && typeof pay === 'object' ? pay : {};
  const update = paymentUpdate && typeof paymentUpdate === 'object'
    ? paymentUpdate
    : {};
  const propertyId = String(
    update.propId || update.propertyId || source.propId || source.propertyId || ''
  ).trim();

  return {
    success: true,
    kind: source.kind,
    propId: propertyId || null,
    propertyId: propertyId || null,
    creditsLeft: typeof update.creditsLeft === 'number'
      ? update.creditsLeft
      : undefined,
    needsReview: update.fulfilmentStatus === 'needs_review'
  };
}

module.exports = { buildCashfreeFulfilmentResult };
