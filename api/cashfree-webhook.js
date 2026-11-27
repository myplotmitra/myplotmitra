'use strict';

const {
  createCashfreeWebhookHandler
} = require('./_cashfree-endpoints');

const handler = async (req, res) => {
  const cashfree = require('./_cashfree');

  return createCashfreeWebhookHandler(cashfree)(req, res);
};

handler.config = { api: { bodyParser: false } };

module.exports = handler;
