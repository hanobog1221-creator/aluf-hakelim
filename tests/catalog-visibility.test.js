const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'catalog-loader.js'), 'utf8');
const storefront = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const productsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'products.js'), 'utf8');
const suppliers = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'suppliers.js'), 'utf8');

test('active products remain visible while supplier verification is pending', () => {
  assert.match(source, /data\.products\.filter\(\(product\) => product\.available !== false\)/);
  assert.doesNotMatch(source, /product\.available !== false && product\.purchaseReady === true/);
});

test('legacy storefront items stay visible but fail closed when absent from the managed catalog', () => {
  assert.match(source, /pendingLegacyProducts/);
  assert.match(source, /purchaseReady: false/);
  assert.match(source, /shippingAvailable: null/);
});

test('the storefront fallback preserves every known catalog product and cache-busts the loader', () => {
  for (const id of ['socket', 'ratchet', 'impact', 'washer', 'ae-1005012832500138', 'ae-1005009577109019']) {
    assert.match(storefront, new RegExp(`id:'${id}'`));
  }
  assert.match(storefront, /catalog-loader\.js\?v=\d{8}-\d+/);
});

test('requested hidden products are restored while the failed battery bundle is removed', () => {
  assert.match(productsApi, /ae-1005007178140659/);
  assert.match(productsApi, /ae-1005009926657110/);
  assert.match(productsApi, /REMOVED_CATALOG_IDS = new Set\(\['battery588'\]\)/);
  assert.doesNotMatch(storefront, /id:'battery588'/);
  assert.doesNotMatch(suppliers, /battery588/);
});

test('purchases remain blocked until supplier verification is complete', () => {
  assert.match(source, /product\.purchaseReady !== true/);
  assert.match(source, /addButton\.disabled = true/);
});
