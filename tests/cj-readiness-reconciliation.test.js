const test = require('node:test');
const assert = require('node:assert/strict');
const { verifiedCjReadiness, pickVariantFromSku } = require('../api/_lib/admin-routes/cj-worker-catalog');

const now = Date.parse('2026-08-21T20:30:00.000Z');
const settings = {
  supplier_quote_ttl_minutes: 480,
  minimum_profit_ils: 10,
  pricing_fee_percent: 5.2,
  pricing_fee_fixed_ils: 1.2,
  pricing_reserve_ils: 0,
  pricing_tax_reserve_percent: 0,
  pricing_insurance_reserve_percent: 0
};

function product(overrides = {}) {
  return {
    id: 'cj-safe-product',
    active: true,
    supplier: 'cj',
    fulfillment_provider: 'cj',
    supplier_product_id: 'pid-1',
    supplier_sku_id: 'vid-1',
    fulfillment_product_id: 'pid-1',
    fulfillment_variant_id: 'vid-1',
    fulfillment_sku: 'CJ-SKU-1',
    fulfillment_verified_at: '2026-08-21T20:20:00.000Z',
    supplier_in_stock: true,
    supplier_shipping_available: true,
    supplier_sync_error: null,
    shipping_sync_error: null,
    last_sync_at: '2026-08-21T20:20:00.000Z',
    shipping_last_checked_at: '2026-08-21T20:20:00.000Z',
    supplier_price_ils: 20,
    supplier_shipping: 10,
    selling_price: 200,
    minimum_profit: 10,
    auto_fulfill_max_cost: 40,
    ...overrides
  };
}

test('reconciles only a fully verified, fresh and profitable CJ product', () => {
  assert.equal(verifiedCjReadiness(product(), settings, now), true);
});

test('does not reconcile a changed or incomplete CJ variant mapping', () => {
  assert.equal(verifiedCjReadiness(product({ fulfillment_variant_id: 'different' }), settings, now), false);
  assert.equal(verifiedCjReadiness(product({ fulfillment_sku: null }), settings, now), false);
});

test('does not reconcile stale, unavailable or unprofitable supplier state', () => {
  assert.equal(verifiedCjReadiness(product({ last_sync_at: '2026-08-20T00:00:00.000Z' }), settings, now), false);
  assert.equal(verifiedCjReadiness(product({ supplier_shipping_available: false }), settings, now), false);
  assert.equal(verifiedCjReadiness(product({ selling_price: 31 }), settings, now), false);
});

test('repairs a unique CJ variant whose SKU extends the stored base SKU', () => {
  const selected = pickVariantFromSku([
    { vid: 'variant-black', variantSku: 'CJQCQCQC00072-Black' },
    { vid: 'other', variantSku: 'CJQC00001-Red' }
  ], 'CJQCQCQC00072');
  assert.equal(selected.vid, 'variant-black');
});

test('does not guess when a CJ base SKU matches multiple variants', () => {
  assert.equal(pickVariantFromSku([
    { vid: 'black', variantSku: 'CJQCQCQC00072-Black' },
    { vid: 'silver', variantSku: 'CJQCQCQC00072-Silver' }
  ], 'CJQCQCQC00072'), null);
});

test('uses the stored variant label to resolve one matching CJ base-SKU variant', () => {
  const selected = pickVariantFromSku([
    { vid: 'black', variantSku: 'CJQCQCQC00072-Black', variantNameEn: 'Black' },
    { vid: 'silver', variantSku: 'CJQCQCQC00072-Silver', variantNameEn: 'Silver' }
  ], 'CJQCQCQC00072', 'Black / single holder');
  assert.equal(selected.vid, 'black');
});
