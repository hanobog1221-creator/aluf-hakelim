const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'catalog-loader.js'), 'utf8');
const storefront = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const productsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'products.js'), 'utf8');
const suppliers = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'suppliers.js'), 'utf8');
const cjCatalogWorker = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'admin-routes', 'cj-worker-catalog.js'), 'utf8');

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
  for (const id of ['socket', 'ratchet', 'impact', 'washer', 'ae-1005012832500138', 'ae-1005007178140659', 'ae-1005009577109019', 'ae-1005009926657110', 'cj-detail-brush', 'cj-car-mop', 'cj-magnetic-ring', 'cj-k5-bits', 'cj-microfiber-towel', 'cj-wash-mitt', 'cj-silicone-squeegee', 'cj-tire-gauge', 'cj-phone-holder', 'cj-kw310-obd']) {
    assert.match(storefront, new RegExp(`id:'${id}'`));
  }
  assert.match(storefront, /catalog-loader\.js\?v=\d{8}-\d+/);
});

test('CJ catalog images are self-hosted and present on disk', () => {
  const ids = ['cj-detail-brush', 'cj-car-mop', 'cj-magnetic-ring', 'cj-k5-bits', 'cj-microfiber-towel', 'cj-wash-mitt', 'cj-silicone-squeegee', 'cj-tire-gauge', 'cj-phone-holder', 'cj-kw310-obd'];
  for (const id of ids) {
    assert.match(storefront, new RegExp(`img:'/assets/products/${id}\\.jpg'`));
    const image = path.join(__dirname, '..', 'assets', 'products', `${id}.jpg`);
    assert.ok(fs.existsSync(image), `${id} image is missing`);
    assert.ok(fs.statSync(image).size > 10_000, `${id} image is unexpectedly small`);
  }
  assert.doesNotMatch(storefront, /img:'https:\/\/placehold\.co/);
});

test('advanced catalog search and filters are present', () => {
  for (const id of ['productSearch', 'priceRange', 'productSort', 'supplierFilter', 'readyOnly', 'favoritesOnly']) {
    assert.match(storefront, new RegExp(`id="${id}"`));
  }
  for (const category of ['cleaning', 'diagnostics', 'gadgets']) {
    assert.match(storefront, new RegExp(`data-filter="${category}"`));
  }
  assert.match(storefront, /data-product-id=/);
});

test('unverified fallback products stay in checking state rather than being mislabeled out of stock', () => {
  assert.match(source, /inStock: null/);
  assert.match(source, /stockStatus: 'checking'/);
});

test('unverified products never display an uncalculated numeric price', () => {
  assert.match(source, /price: null/);
  assert.match(source, /pricePending: true/);
  assert.match(storefront, /p\.purchaseReady===true&&Number\.isFinite\(Number\(p\.price\)\)/);
  assert.match(storefront, /מחיר בבדיקה/);
  assert.doesNotMatch(storefront, /<div class="priceRow"><span class="price">\$\{money\(p\.price\)\}/);
});

test('requested hidden products are restored while the failed battery bundle is removed', () => {
  assert.match(productsApi, /ae-1005007178140659/);
  assert.match(productsApi, /ae-1005009926657110/);
  assert.match(productsApi, /REMOVED_CATALOG_IDS = new Set\(\['battery588'\]\)/);
  assert.doesNotMatch(storefront, /id:'battery588'/);
  assert.doesNotMatch(suppliers, /battery588/);
});

test('known products stay visible and show an explicit out-of-stock state', () => {
  assert.match(productsApi, /RETAINED_CATALOG_IDS/);
  assert.match(productsApi, /supplier_in_stock/);
  assert.match(productsApi, /const outOfStock = row\.supplier_in_stock === false/);
  assert.match(productsApi, /stockStatus = outOfStock \? 'out_of_stock'/);
  assert.match(source, /product\.stockStatus === 'out_of_stock'/);
  assert.match(source, /אזל מהמלאי — אפשר לשלוח קישור חלופי/);
  assert.match(source, /המוצר אזל מהמלאי ולא ניתן להזמין אותו כרגע/);
});

test('purchases remain blocked until supplier verification is complete', () => {
  assert.match(source, /product\.purchaseReady !== true/);
  assert.match(source, /addButton\.disabled = true/);
});

test('every known CJ storefront product is seeded into the managed admin catalog', () => {
  for (const id of ['cj-detail-brush', 'cj-car-mop', 'cj-magnetic-ring', 'cj-k5-bits', 'cj-microfiber-towel', 'cj-wash-mitt', 'cj-silicone-squeegee', 'cj-tire-gauge', 'cj-phone-holder', 'cj-kw310-obd']) {
    assert.match(cjCatalogWorker, new RegExp(`id: '${id}'`));
  }
  assert.match(cjCatalogWorker, /ensureKnownCatalogProducts\(allProducts, settings\)/);
  assert.match(cjCatalogWorker, /variantFromSku\(mapping\.productId, mapping\.skuId\)/);
  assert.match(cjCatalogWorker, /fulfillment_ready: false/);
});

test('catalog exposes sanitized verification state and admin hides placeholder prices', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin-v2.html'), 'utf8');
  assert.match(productsApi, /verificationStatus:/);
  assert.match(productsApi, /verificationFailed:/);
  assert.match(productsApi, /lastCheckedAt:/);
  assert.match(admin, /מחיר בבדיקה/);
  assert.match(admin, /quote\.recommendedProductPrice/);
});
