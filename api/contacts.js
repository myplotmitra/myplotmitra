'use strict';

const { createDispatcher } = require('./_route-dispatcher');

module.exports = createDispatcher({
  'use-credit': require('./use-credit'),
  'contact-request': require('./contact-request'),
  'property-contact': require('./property-contact'),
});
