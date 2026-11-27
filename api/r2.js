'use strict';

const { createDispatcher } = require('./_route-dispatcher');

module.exports = createDispatcher({
  'r2-upload-url': require('./r2-upload-url'),
  'r2-finalize-upload': require('./r2-finalize-upload'),
  'r2-cleanup-uploads': require('./r2-cleanup-uploads'),
});
