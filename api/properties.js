'use strict';

const { createDispatcher } = require('./_route-dispatcher');

module.exports = createDispatcher({
  'my-properties': require('./my-properties'),
  'property-update': require('./property-update'),
  'property-mark-sold': require('./property-mark-sold'),
  'r2-delete-property': require('./r2-delete-property'),
  'property-create': require('./property-create'),
  'rental-draft-create': require('./rental-draft-create'),
  'property-posting-pricing': require('./_property-posting-pricing'),
});
