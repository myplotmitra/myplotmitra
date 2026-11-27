'use strict';

const {
  createCashfreeVerifyHandler
} = require('./_cashfree-endpoints');

const handler = async (req, res) => {
  const cashfree = require('./_cashfree');
  const { authenticate } = require('./_r2');

  return createCashfreeVerifyHandler({
    ...cashfree,
    authenticate
  })(req, res);
};

module.exports = handler;
