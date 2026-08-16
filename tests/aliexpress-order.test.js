const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPlaceOrderRequest,
  buildPlaceOrderRequests,
  safePreview,
  parsePlaceOrderResponse,
  normalizeOrderIds
} = require('../api/_lib/aliexpress-order');

function sampleOrder() {
  return {
    customer: {
      fullName: 'Test Customer',
      phone: '052-123-4567',
      city: 'Jerusalem',
      street: 'Test Street',
      houseNumber: '10',
      apartment: '3',
      postalCode: '9100000'
    },
    items: [
      {
        id: 'impact',
        qty: 2,
        supplierProductId: '1005010616492119',
        supplierSkuId: '14:70221'
      }
    ],
    shipping_quote: {
      lines: [
        { id: 'impact', serviceName: 'Old Shipping Service' }
      ]
    }
  };
}

test('buildPlaceOrderRequest normalizes Israeli phone and supplier item', () => {
  const request = buildPlaceOrderRequest(sampleOrder());
  assert.equal(request.logistics_address.country, 'IL');
  assert.equal(request.logistics_address.phone_country, '+972');
  assert.equal(request.logistics_address.mobile_no, '521234567');
  assert.equal(request.product_items[0].product_id, 1005010616492119);
  assert.equal(request.product_items[0].sku_attr, '14:70221');
  assert.equal(request.product_items[0].product_count, 2);
});

test('builds one real supplier request per supplier identity', () => {
  const order = sampleOrder();
  order.items[0].supplierId = 'store-a';
  order.items.push({
    id: 'socket', qty: 1, supplierId: 'store-b',
    supplierProductId: '1005012906553288', supplierSkuId: '14:123'
  });
  order.shipping_quote.lines.push({ id: 'socket', serviceName: 'AliExpress Standard Shipping' });
  const groups = buildPlaceOrderRequests(order);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.supplierId), ['store-a', 'store-b']);
  assert.equal(groups.every((group) => group.request.product_items.length === 1), true);
});

test('buildPlaceOrderRequest requires an exact shipping service', () => {
  const order = sampleOrder();
  order.shipping_quote.lines = [];
  assert.throws(() => buildPlaceOrderRequest(order), /shipping_service_missing_impact/);
});

test('fresh shipping quote overrides the stale order shipping service', () => {
  const order = sampleOrder();
  const freshQuote = {
    lines: [{ id: 'impact', serviceName: 'Fresh AliExpress Shipping' }]
  };
  const request = buildPlaceOrderRequest(order, freshQuote);
  assert.equal(request.product_items[0].logistics_service_name, 'Fresh AliExpress Shipping');
  assert.notEqual(request.product_items[0].logistics_service_name, 'Old Shipping Service');
});

test('fresh quote without a valid service blocks instead of falling back to stale service', () => {
  const order = sampleOrder();
  const freshQuote = { lines: [{ id: 'impact', serviceName: '' }] };
  assert.throws(() => buildPlaceOrderRequest(order, freshQuote), /shipping_service_missing_impact/);
});

test('safePreview does not expose raw phone or street address', () => {
  const request = buildPlaceOrderRequest(sampleOrder());
  const preview = safePreview(request);
  const serialized = JSON.stringify(preview);
  assert.equal(serialized.includes('052-123-4567'), false);
  assert.equal(serialized.includes('Test Street'), false);
  assert.equal(preview.logistics_address.phonePresent, true);
  assert.equal(preview.logistics_address.addressPresent, true);
});

test('parsePlaceOrderResponse extracts multiple supplier order IDs', () => {
  const parsed = parsePlaceOrderResponse({
    aliexpress_trade_buy_placeorder_response: {
      result: {
        is_success: true,
        order_list: { number: [1000000001, 1000000002] }
      }
    }
  });
  assert.equal(parsed.outcome, 'created');
  assert.deepEqual(parsed.orderIds, ['1000000001', '1000000002']);
  assert.equal(parsed.shouldReconcile, false);
});

test('repeated order error is ambiguous and must be reconciled, not retried blindly', () => {
  const parsed = parsePlaceOrderResponse({
    aliexpress_trade_buy_placeorder_response: {
      result: {
        is_success: false,
        error_code: 'REPEATED_ORDER_ERROR',
        error_msg: 'repeated placed order'
      }
    }
  });
  assert.equal(parsed.outcome, 'ambiguous');
  assert.equal(parsed.shouldReconcile, true);
});

test('success without order IDs is treated as ambiguous', () => {
  const parsed = parsePlaceOrderResponse({
    aliexpress_trade_buy_placeorder_response: {
      result: { is_success: true, order_list: { number: [] } }
    }
  });
  assert.equal(parsed.outcome, 'ambiguous');
  assert.equal(parsed.shouldReconcile, true);
});

test('normalizeOrderIds deduplicates and rejects invalid IDs', () => {
  assert.deepEqual(
    normalizeOrderIds({ number: [100001, '100001', 'abc', null, 200002] }),
    ['100001', '200002']
  );
});

