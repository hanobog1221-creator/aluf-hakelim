const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectBestOffer,
  requiredSellingPrice,
  pricingForOffer
} = require('../api/_lib/supplier-optimizer');
const { unchangedVerifiedCurrentOffer } = require('../api/_lib/admin-routes/supplier-optimizer');

const NOW = Date.parse('2026-08-19T10:00:00.000Z');

function offer(overrides = {}) {
  return {
    provider: 'cj',
    supplier_product_id: 'PID-1',
    supplier_sku_id: 'VID-1',
    product_price_ils: 40,
    shipping_price_ils: 12,
    in_stock: true,
    shipping_available: true,
    equivalence_verified: true,
    fulfillment_supported: true,
    last_sync_at: '2026-08-19T09:00:00.000Z',
    shipping_last_checked_at: '2026-08-19T09:00:00.000Z',
    ...overrides
  };
}

test('selects by product plus shipping rather than product price alone', () => {
  const cheapProductExpensiveShipping = offer({ provider: 'cj', product_price_ils: 30, shipping_price_ils: 30 });
  const higherProductCheapShipping = offer({ provider: 'aliexpress', supplier_sku_attr: '14:1', product_price_ils: 40, shipping_price_ils: 5 });
  const result = selectBestOffer([cheapProductExpensiveShipping, higherProductCheapShipping], { now: NOW });
  assert.equal(result.selected.normalized.provider, 'aliexpress');
  assert.equal(result.selected.normalized.landedCost, 45);
});

test('fails closed for stale, unverified, out-of-stock, or non-automated offers', () => {
  const result = selectBestOffer([
    offer({ last_sync_at: '2026-08-18T00:00:00.000Z' }),
    offer({ equivalence_verified: false }),
    offer({ in_stock: false }),
    offer({ provider: 'cj', fulfillment_supported: false }),
    offer({ provider: 'alibaba', fulfillment_supported: false })
  ], { now: NOW });
  assert.equal(result.selected, null);
  assert.deepEqual(result.evaluated.map((row) => row.eligible), [false, false, false, false, false]);
});

test('requires AliExpress SKU attributes before automatic selection', () => {
  const result = selectBestOffer([offer({ provider: 'aliexpress', supplier_sku_attr: null })], { now: NOW });
  assert.equal(result.selected, null);
  assert.ok(result.evaluated[0].blockers.includes('supplier_sku_attr_missing'));
});

test('uses the same upward .90 retail ending as the automatic pricing engine', () => {
  assert.equal(requiredSellingPrice(40.2, 20), 60.9);
});

test('pricing includes fee and reserve configuration while shipping is charged separately', () => {
  const pricing = pricingForOffer(offer(), 20, { paymentFeePercent: 4, paymentFeeFixedIls: 1, reserveIls: 2 });
  assert.equal(pricing.customerShipping, 12);
  assert.ok(pricing.projectedNetProfit >= 20);
  assert.equal(pricing.incomeTaxReserve, 0);
  assert.equal(pricing.insuranceReserve, 0);
});

test('can still model an explicit reserve without changing the live default', () => {
  const pricing = pricingForOffer(offer(), 20, { taxReservePercent: 22, insuranceReservePercent: 18 });
  assert.ok(pricing.projectedNetProfit >= 20);
  assert.equal(Number((pricing.incomeTaxReserve + pricing.insuranceReserve).toFixed(2)), Number((pricing.preTaxProfit * 0.4).toFixed(2)));
});

test('does not rewrite an unchanged current offer that is already fulfillment-ready', () => {
  assert.equal(unchangedVerifiedCurrentOffer({
    selectedOffer: { source: 'current_product' },
    currentFulfillmentReady: true,
    currentProvider: 'cj',
    selectedProvider: 'cj',
    currentLandedCost: 52,
    selectedLandedCost: 52,
    currentSellingPrice: 89,
    pricing: { sellingPrice: 89 }
  }), true);
});

test('still applies a changed price, supplier, cost, or unready current offer', () => {
  const base = {
    selectedOffer: { source: 'current_product' }, currentFulfillmentReady: true,
    currentProvider: 'cj', selectedProvider: 'cj', currentLandedCost: 52,
    selectedLandedCost: 52, currentSellingPrice: 89, pricing: { sellingPrice: 89 }
  };
  assert.equal(unchangedVerifiedCurrentOffer({ ...base, currentFulfillmentReady: false }), false);
  assert.equal(unchangedVerifiedCurrentOffer({ ...base, selectedProvider: 'aliexpress' }), false);
  assert.equal(unchangedVerifiedCurrentOffer({ ...base, selectedLandedCost: 53 }), false);
  assert.equal(unchangedVerifiedCurrentOffer({ ...base, pricing: { sellingPrice: 90 } }), false);
});
