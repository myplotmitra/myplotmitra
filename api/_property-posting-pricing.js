'use strict';

const { admin, authenticate } = require('./_r2');
const { SOCIAL_PROMOTION_PRICE_PER_PLATFORM } = require('./_social-promotion-policy');

const settingPrice = (settings, key, fallback) => {
  if (settings[key] == null || settings[key] === '') return fallback;
  const value = Number(settings[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  try {
    await authenticate(req);
    const snap = await admin.firestore().collection('settings').doc('app').get();
    const settings = snap.exists ? snap.data() || {} : {};
    const rentalBasePrice = settingPrice(settings, 'rentalBasePrice', 20);
    const rentalIncludedPhotos = settingPrice(settings, 'rentalIncludedPhotos', 3);
    const rentalExtraPhotoPrice = settingPrice(settings, 'rentalExtraPhotoPrice', 10);
    const rentalMaxPhotos = settingPrice(settings, 'rentalMaxPhotos', 20);
    const featuredPrice = settingPrice(settings, 'featuredPrice', 499) || 499;
    if (rentalBasePrice < 1 || rentalIncludedPhotos < 1 || rentalMaxPhotos < 1 || rentalMaxPhotos > 100) {
      return res.status(503).json({ error: 'Property posting prices are not configured correctly.' });
    }
    return res.status(200).json({
      success: true,
      currency: 'INR',
      rentalPaymentEnabled: settings.rentalPaymentEnabled === true,
      rentalOnePhotoFreeEnabled: settings.rentalOnePhotoFreeEnabled !== false,
      rentalBasePrice,
      rentalIncludedPhotos,
      rentalExtraPhotoPrice,
      rentalMaxPhotos,
      saleMaxPhotos: settingPrice(settings, 'saleMaxPhotos', 20),
      featuredPrice,
      socialPromotionPrice: SOCIAL_PROMOTION_PRICE_PER_PLATFORM
    });
  } catch (error) {
    const status = Number(error.status) || (/Authentication required/i.test(String(error.message)) ? 401 : 500);
    return res.status(status).json({ error: status === 401 ? 'Please sign in again' : 'Could not load property posting prices.' });
  }
};
