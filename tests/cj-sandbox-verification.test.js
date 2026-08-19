const test = require('node:test');
const assert = require('node:assert/strict');
const { cheapestFreight, sandboxOrderRequest, orderIdFrom, runCjSandboxVerification } = require('../api/_lib/cj-sandbox-verification');

test('selects the cheapest valid freight row', () => {
  const selected = cheapestFreight([
    { logisticName: 'slow', logisticPrice: '4.50' },
    { logisticName: 'cheap', logisticPrice: '1.25' },
    { logisticName: 'invalid', logisticPrice: null }
  ]);
  assert.equal(selected.logisticName, 'cheap');
});

test('sandbox request can never create a live charge', () => {
  const request = sandboxOrderRequest({
    identity: { vid: 'V1', sku: 'SKU1' }, origin: 'CN', freight: { logisticName: 'CJPacket', logisticPrice: 2 }
  }, 123);
  assert.equal(request.isSandbox, 1);
  assert.equal(request.payType, 3);
  assert.equal(request.shippingCountryCode, 'IL');
});

test('extracts both current and legacy CJ order identifiers', () => {
  assert.equal(orderIdFrom({ data: { orderId: 'O1' } }), 'O1');
  assert.equal(orderIdFrom({ data: 'O2' }), 'O2');
});

test('verifies product, Israel freight, simulated payment and sandbox tracking without a charge', async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.startsWith('/product/variant/queryByVid')) return { code: 200, data: { vid: 'VID1', variantSku: 'SKU1', pid: 'P1', variantSellPrice: 0.6, inventories: [{ countryCode: 'CN', totalInventory: 5 }] } };
    if (path === '/logistic/freightCalculate') return { code: 200, data: [{ logisticName: 'CJPacket', logisticPrice: 2.1 }] };
    if (path === '/shopping/order/createOrderV2') return { code: 200, data: { orderId: 'SBX1' } };
    if (path.includes('getOrderDetail')) {
      const tracked = calls.some((call) => call.path === '/shopping/sandbox/updateTrackNumber');
      return { code: 200, data: { orderStatus: tracked ? 'UNSHIPPED' : 'UNPAID', isSandbox: 1, trackNumber: tracked ? 'AH-SBX-TRACK-99' : null } };
    }
    if (path === '/shopping/sandbox/simulatePay' || path === '/shopping/sandbox/updateTrackNumber') return { code: 200, data: true };
    throw new Error(`unexpected_${path}`);
  };
  const result = await runCjSandboxVerification({ request, preferredVids: ['VID1'], now: 99 });
  assert.equal(result.ok, true);
  assert.equal(result.charged, false);
  assert.equal(result.realFulfillmentCreated, false);
  assert.equal(result.shipping.destination, 'IL');
  assert.equal(calls.find((call) => call.path === '/shopping/order/createOrderV2').options.body.isSandbox, 1);
});
