'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

for (const id of ['socialPromoYoutube', 'socialPromoFacebook', 'socialPromoInstagram']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing posting checkbox ${id}`);
}
assert.match(html, /₹500 per selected platform/);
assert.match(html, /id=["']socialPromotionTotal["']/);
assert.match(html, /function renderPublishedSocialLinks\(property\)/);
assert.match(html, /item\.paymentStatus!=='paid'\|\|item\.published!==true\|\|item\.status!=='published'/);
assert.match(html, /class="card-social-overlay"/);
assert.match(html, /window\.renderSocialPromotionsAdmin/);
assert.match(html, /fetch\('\/api\/admin-social-promotion'/);
assert.match(html, /window\.cashfreePay\('social_promotion'/);
assert.match(html, /websiteAuthenticatedPost\('property-create'/);

const adminRouteIndex = vercel.routes.findIndex(route => route.src === '/api/admin-social-promotion');
const filesystemIndex = vercel.routes.findIndex(route => route.handle === 'filesystem');
assert.ok(adminRouteIndex >= 0, 'admin social promotion route is missing');
assert.ok(filesystemIndex >= 0, 'filesystem route is missing');
assert.ok(adminRouteIndex < filesystemIndex, 'admin social promotion route must precede filesystem handler');

console.log('Social promotion website integration checks passed');
