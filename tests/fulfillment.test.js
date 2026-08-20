const test = require('node:test');
const assert = require('node:assert/strict');

const { validateFulfillmentOrder, MAX_SUPPLIER_STATE_AGE_MS } = require('../api/_lib/fulfillment');

function baseOrder(overrides = {}) {
  return {
    order_id: 'AH-TEST-1234',
    payment_status: 'paid',
    shipping_quote_status: 'quoted',
    supplier_order_id: null,
    supplier_order_ids: [],
    fulfillment_status: 'not_started',
    items: [{
      id: 'impact',
      supplier: 'aliexpress',
      fulfillmentReady: true,
      supplierProductId: '1005010616492119',
      supplierSkuId: '12000059637959044',
      supplierSkuAttr: '14:12345',
      qty: 1,
      price: 100
    }],
    customer: {
      fullName: 'Test Customer',
      phone: '0500000000',
      city: 'Jerusalem',
      street: 'Test',
      houseNumber: '1'
    },
    ...overrides
  };
}

function baseProduct(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'impact',
    active: true,
    max_order_quantity: 20,
    supplier: 'aliexpress',
    supplier_product_id: '1005010616492119',
    supplier_sku_id: '12000059637959044',
    supplier_sku_attr: '14:12345',
    fulfillment_ready: true,
    supplier_price_ils: 50,
    supplier_shipping: 5,
    supplier_in_stock: true,
    supplier_shipping_available: true,
    last_sync_at: now,
    shipping_last_checked_at: now,
    minimum_profit: null,
    auto_fulfill_max_cost: null,
    ...overrides
  };
}

function state(product = baseProduct(), settings = { sales_enabled: true, minimum_profit_ils: 10 }) {
  return {
    products: new Map([[String(product.id), product]]),
    settings: { sales_enabled: true, minimum_profit_ils: 10, ...settings }
  };
}

test('allows a fully ready paid order when sales are enabled', () => {
  const order = baseOrder();
  order.items[0].price = 150;
  assert.deepEqual(validateFulfillmentOrder(order, state()), { ok: true });
});

test('global sales switch blocks fulfillment even for an already-paid order', () => {
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct(), { sales_enabled: false }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sales_disabled');
});

test('blocks an AliExpress order that did not snapshot a verified SKU attribute path', () => {
  const order = baseOrder();
  delete order.items[0].supplierSkuAttr;
  const result = validateFulfillmentOrder(order, state());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_sku_attr_not_verified');
});

test('blocks when the AliExpress SKU attribute mapping changed after checkout', () => {
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct({ supplier_sku_attr: '14:DIFFERENT' })));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_mapping_changed');
});

test('blocks unknown supplier stock', () => {
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct({ supplier_in_stock: null })));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_stock_unknown');
});

test('blocks when minimum profit is not configured', () => {
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct(), { minimum_profit_ils: null }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'minimum_profit_not_configured');
});

test('blocks stale supplier product sync', () => {
  const stale = new Date(Date.now() - MAX_SUPPLIER_STATE_AGE_MS - 60_000).toISOString();
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct({ last_sync_at: stale })));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_product_sync_stale');
});

test('blocks stale shipping sync', () => {
  const stale = new Date(Date.now() - MAX_SUPPLIER_STATE_AGE_MS - 60_000).toISOString();
  const result = validateFulfillmentOrder(baseOrder(), state(baseProduct({ shipping_last_checked_at: stale })));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_shipping_sync_stale');
});

test('blocks an order that already has supplier order IDs', () => {
  const result = validateFulfillmentOrder(baseOrder({ supplier_order_ids: ['123456789'] }), state());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_order_already_exists');
});

test('blocks supplier cost above the per-product automatic limit', () => {
  const result = validateFulfillmentOrder(
    baseOrder(),
    state(baseProduct({ supplier_price_ils: 50, supplier_shipping: 10, auto_fulfill_max_cost: 55 }))
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'supplier_cost_above_auto_limit');
  assert.equal(result.totalSupplierCost, 60);
});

test('blocks when minimum net profit after the 40 percent reserve would not be met', () => {
  const result = validateFulfillmentOrder(
    baseOrder(),
    state(baseProduct({ supplier_price_ils: 95 }), { minimum_profit_ils: 10 })
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'minimum_profit_not_met');
  assert.equal(result.profitPerUnit, 1.11);
});
