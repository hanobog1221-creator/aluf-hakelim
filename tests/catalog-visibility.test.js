const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'catalog-loader.js'), 'utf8');
const storefront = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const productsApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'products.js'), 'utf8');
const suppliers = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'suppliers.js'), 'utf8');
const cjCatalogWorker = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'admin-routes', 'cj-worker-catalog.js'), 'utf8');

test('the customer catalog contains only products ready for purchase', () => {
  assert.match(source, /data\.products\.filter\(\(product\) => product\.available !== false && product\.purchaseReady === true\)/);
});

test('legacy fallback items are not merged into the live managed catalog', () => {
  assert.doesNotMatch(source, /pendingLegacyProducts/);
  assert.match(source, /products\.splice\(0, products\.length, \.\.\.visibleProducts\)/);
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
  for (const id of ['productSearch', 'priceRange', 'productSort', 'readyOnly', 'favoritesOnly']) {
    assert.match(storefront, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(storefront, /id="supplierFilter"/);
  assert.doesNotMatch(storefront, /productSource/);
  for (const category of ['cleaning', 'diagnostics', 'gadgets']) {
    assert.match(storefront, new RegExp(`data-filter="${category}"`));
  }
  assert.match(storefront, /data-product-id=/);
});

test('unverified managed products are not exposed in the customer catalog', () => {
  assert.match(source, /product\.purchaseReady === true/);
  assert.doesNotMatch(source, /pendingLegacyProducts/);
});

test('unverified products never display an uncalculated numeric price', () => {
  assert.match(source, /product\.purchaseReady === true/);
  assert.match(storefront, /p\.priceVerified===true&&Number\.isFinite\(Number\(p\.price\)\)/);
  assert.match(storefront, /פרטים בקרוב/);
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
  assert.match(source, /המוצר אזל מהמלאי/);
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
  assert.match(cjCatalogWorker, /variantFromSku\(selectedProductId, selectedSku, selectedVariantLabel\)/);
  assert.match(cjCatalogWorker, /findKnownReplacement\(seed, usedSupplierIds\)/);
  assert.match(cjCatalogWorker, /current && verifiedCjReadiness\(current, settings\)/);
  assert.match(cjCatalogWorker, /id: 'cj-phone-holder', search: 'car phone holder'/);
  assert.match(cjCatalogWorker, /cj_variant_sku_mismatch/);
  assert.match(cjCatalogWorker, /fulfillment_ready: false/);
});

test('catalog exposes sanitized verification state and admin hides placeholder prices', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin-v2.html'), 'utf8');
  assert.match(productsApi, /verificationStatus:/);
  assert.match(productsApi, /verificationFailed:/);
  assert.match(productsApi, /lastCheckedAt/);
  assert.match(productsApi, /priceVerified/);
  assert.match(productsApi, /verifiedStatus/);
  assert.match(productsApi, /minimum_net_profit_not_met/);
  assert.match(productsApi, /pricingSafe/);
  assert.match(productsApi, /priceBlockers/);
  assert.match(admin, /מחיר בבדיקה/);
  assert.match(admin, /quote\.recommendedProductPrice/);
});

test('pricing workers never use a processing fee below the Whop policy floor', () => {
  const optimizer = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'admin-routes', 'supplier-optimizer.js'), 'utf8');
  const fulfillment = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'fulfillment.js'), 'utf8');
  assert.match(cjCatalogWorker, /Math\.max\(policy\.processingFeeRate \* 100/);
  assert.match(optimizer, /Math\.max\(policy\.processingFeeRate \* 100/);
  assert.match(fulfillment, /Math\.max\(pricingPolicy\(\)\.processingFeeRate \* 100/);
});

test('catalog reprices stored verified costs before slow supplier repair calls', () => {
  assert.match(cjCatalogWorker, /async function repriceStoredCatalog/);
  assert.match(cjCatalogWorker, /minimum_profit=lt\.\$\{DEFAULT_MINIMUM_PROFIT_ILS\}/);
  assert.match(cjCatalogWorker, /minimum_profit=gt\.\$\{DEFAULT_MINIMUM_PROFIT_ILS\}/);
  assert.ok(cjCatalogWorker.indexOf('repriceStoredCatalog(allProducts, settings)') < cjCatalogWorker.indexOf('ensureKnownCatalogProducts(allProducts, settings)'));
});

test('customer storefront hides supplier and verification language', () => {
  assert.doesNotMatch(storefront, /ספק: \$\{supplier\}/);
  assert.doesNotMatch(storefront, /זמינות בבדיקה/);
  assert.doesNotMatch(source, /PayPal LIVE|זמינות ומשלוח בבדיקה/);
  assert.match(storefront, /customerSpecs/);
  assert.match(storefront, /לא זמין כרגע/);
});

test('launch storefront prioritizes purchasable products and easy navigation', () => {
  const policies = fs.readFileSync(path.join(__dirname, '..', 'policies.html'), 'utf8');
  const tracking = fs.readFileSync(path.join(__dirname, '..', 'track.html'), 'utf8');
  assert.match(storefront, /readyOnly:true/);
  assert.match(storefront, /id="readyOnly" type="checkbox" checked/);
  assert.match(storefront, /class="mobileDock"/);
  assert.match(storefront, /href="\/track"/);
  assert.match(storefront, /href="\/policies"/);
  assert.match(storefront, /קנייה פשוטה, בלי הפתעות/);
  assert.doesNotMatch(policies, /ספק חלופי מאומת|אותו מוצר ווריאנט/);
  assert.doesNotMatch(tracking, /מסנכרן מעקב|דורשת בדיקה/);
});

test('the owner-approved 10 ILS net floor is enforced across admin and fulfillment', () => {
  const adminProducts = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'admin-routes', 'products.js'), 'utf8');
  const fulfillment = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'fulfillment.js'), 'utf8');
  assert.match(adminProducts, /Math\.max\(10, cleanNumber\(body\.minimum_profit_ils/);
  assert.match(adminProducts, /Math\.max\(10, cleanNumber\(body\.minimum_profit/);
  assert.match(fulfillment, /Math\.max\(10, configuredMinimumProfit\)/);
});
