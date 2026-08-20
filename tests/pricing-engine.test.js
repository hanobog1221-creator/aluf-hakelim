const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pricingPolicy,
  quoteProductPrice,
  autoPriceUpdate,
  roundRetailUp
} = require('../api/_lib/pricing-engine');

test('defaults to a 20 ILS target after a 40 percent tax and insurance reserve', () => {
  const policy = pricingPolicy({});
  assert.equal(policy.targetNetProfitIls, 20);
  assert.equal(policy.taxReserveRate, 0.40);
  assert.equal(policy.vatRate, 0.18);
  assert.equal(policy.serviceFeeRate + policy.processingFeeRate, 0.08);
});

test('keeps the owner-approved 20 ILS target when a stale deployment variable still says 25', () => {
  assert.equal(pricingPolicy({ PRICING_TARGET_NET_PROFIT_ILS: '25' }).targetNetProfitIls, 20);
});

test('rounds a calculated price upward to a .90 retail ending', () => {
  assert.equal(roundRetailUp(197.10), 197.90);
  assert.equal(roundRetailUp(197.95), 198.90);
});

test('price quote includes VAT, provider fees, advertising, supplier buffer and cancellation reserve', () => {
  const quote = quoteProductPrice({ supplierPriceIls: 100, supplierShippingIls: 0 });
  assert.equal(quote.ready, true);
  assert.ok(quote.recommendedProductPrice > 192.90);
  assert.ok(quote.estimatedNetProfit >= 20);
  assert.equal(quote.cancellationReserve, 2.45);
  assert.equal(quote.advertisingCost, 15);
  assert.equal(quote.supplierBuffer, 5);
});

test('does not change a live price when supplier shipping is unknown', () => {
  const result = autoPriceUpdate({ selling_price: 149.90, supplier_price_ils: 80, supplier_shipping: null });
  assert.equal(result.quote.ready, false);
  assert.deepEqual(result.update, {});
});

test('updates the product price automatically when verified supplier costs change', () => {
  const result = autoPriceUpdate({ selling_price: 149.90, old_price: null }, { supplierPriceIls: 100, supplierShippingIls: 20 });
  assert.equal(result.quote.ready, true);
  assert.ok(result.update.selling_price > 199.90);
});
