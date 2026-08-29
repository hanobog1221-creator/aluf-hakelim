const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pricingPolicy,
  quoteProductPrice,
  autoPriceUpdate,
  roundRetailUp
} = require('../api/_lib/pricing-engine');

test('defaults to 10 ILS after supplier cost and transaction fees only', () => {
  const policy = pricingPolicy({});
  assert.equal(policy.targetNetProfitIls, 10);
  assert.equal(policy.taxReserveRate, 0);
  assert.equal(policy.vatRate, 0);
  assert.equal(policy.processingFeeRate, 0.052);
  assert.equal(policy.processingFeeFixedIls, 1.20);
  assert.equal(policy.priceEnding, 0);
});

test('keeps the owner-approved 10 ILS target when a stale deployment variable differs', () => {
  const policy = pricingPolicy({ PRICING_TARGET_NET_PROFIT_ILS: '25', PRICING_PRICE_ENDING: '0.90' });
  assert.equal(policy.targetNetProfitIls, 10);
  assert.equal(policy.priceEnding, 0);
});

test('environment configuration cannot undercut production cost floors', () => {
  const policy = pricingPolicy({
    PRICING_VAT_RATE: '0.17',
    PRICING_SERVICE_FEE_RATE: '0.01',
    PRICING_PROCESSING_FEE_RATE: '0.01',
    PRICING_AD_COST_ILS: '1',
    PRICING_CANCELLATION_RATE: '0.01',
    PRICING_REFUND_FEE_ILS: '1',
    PRICING_SUPPLIER_BUFFER_RATE: '0.01'
  });
  assert.equal(policy.vatRate, 0);
  assert.equal(policy.serviceFeeRate, 0);
  assert.equal(policy.processingFeeRate, 0.052);
  assert.equal(policy.advertisingCostIls, 0);
  assert.equal(policy.cancellationRate * policy.refundFeeIls, 0);
  assert.equal(policy.supplierBufferRate, 0);
});

test('meets the required 10 ILS floor without unrelated reserves', () => {
  const quote = quoteProductPrice({ supplierPriceIls: 50, supplierShippingIls: 10 });
  assert.ok(quote.estimatedNetProfit >= 10);
  assert.equal(quote.policy.targetNetProfitIls, 10);
  assert.equal(quote.policy.safetyNetProfitIls, 0);
});

test('rounds a calculated price upward to a .90 retail ending', () => {
  assert.equal(roundRetailUp(197.10), 197.90);
  assert.equal(roundRetailUp(197.95), 198.90);
});

test('price quote includes only supplier cost and transaction fees', () => {
  const quote = quoteProductPrice({ supplierPriceIls: 100, supplierShippingIls: 0 });
  assert.equal(quote.ready, true);
  assert.ok(quote.recommendedProductPrice >= 117.90);
  assert.ok(quote.estimatedNetProfit >= 10);
  assert.equal(quote.cancellationReserve, 0);
  assert.equal(quote.advertisingCost, 0);
  assert.equal(quote.supplierBuffer, 0);
});

test('does not change a live price when supplier shipping is unknown', () => {
  const result = autoPriceUpdate({ selling_price: 149.90, supplier_price_ils: 80, supplier_shipping: null });
  assert.equal(result.quote.ready, false);
  assert.deepEqual(result.update, {});
});

test('updates the product price automatically when verified supplier costs change', () => {
  const result = autoPriceUpdate({ selling_price: 149.90, old_price: null }, { supplierPriceIls: 100, supplierShippingIls: 20 });
  assert.equal(result.quote.ready, true);
  assert.ok(result.update.selling_price >= 118);
});
