const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOrderDetailResponse,
  parseTrackingResponse,
  supplierOrderIds,
  isAliExpressOrder
} = require('../api/_lib/aliexpress-tracking');

test('parses AliExpress dropshipping order logistics', () => {
  const parsed = parseOrderDetailResponse({
    aliexpress_trade_ds_order_get_response: {
      result: {
        order_status: 'FUND_PROCESSING',
        logistics_status: 'SELLER_SEND_GOODS',
        logistics_info_list: {
          aeop_order_logistics_info: [
            { logistics_no: 'CP0_318495001', logistics_service: 'EMS' }
          ]
        }
      }
    }
  });
  assert.equal(parsed.orderStatus, 'FUND_PROCESSING');
  assert.equal(parsed.logisticsStatus, 'SELLER_SEND_GOODS');
  assert.deepEqual(parsed.logistics, [{ number: 'CP0_318495001', service: 'EMS' }]);
});

test('extracts latest event and pickup point from tracking response', () => {
  const parsed = parseTrackingResponse({
    aliexpress_logistics_ds_trackinginfo_query_response: {
      result_success: true,
      official_website: 'carrier.example.com/track',
      details: {
        details: [
          { event_desc: 'Arrived at local facility', status: 'IN_TRANSIT', address: 'Jerusalem', event_date: '2026-08-18T08:00:00Z' },
          { event_desc: 'Ready for pickup at parcel locker', status: 'READY_FOR_PICKUP', address: 'King George 10, Jerusalem', event_date: '2026-08-18T10:00:00Z' }
        ]
      }
    }
  });
  assert.equal(parsed.latestEvent.status, 'READY_FOR_PICKUP');
  assert.equal(parsed.pickupPoint.address, 'King George 10, Jerusalem');
  assert.match(parsed.officialWebsite, /^https:\/\/carrier\.example\.com/);
});

test('does not invent pickup point from an ordinary transit address', () => {
  const parsed = parseTrackingResponse({
    aliexpress_logistics_ds_trackinginfo_query_response: {
      result_success: true,
      details: { details: [{ event_desc: 'Departed facility', status: 'IN_TRANSIT', address: 'Tel Aviv', event_date: '2026-08-18' }] }
    }
  });
  assert.equal(parsed.pickupPoint, null);
});

test('only accepts numeric AliExpress supplier order ids', () => {
  assert.deepEqual(supplierOrderIds({ supplier_order_id: '1234567890', supplier_order_ids: ['1234567890', 'BAD'] }), ['1234567890']);
  assert.deepEqual(supplierOrderIds({ supplier_order_id: 'SD2608171737070640900' }), []);
});

test('identifies AliExpress orders without touching CJ orders', () => {
  assert.equal(isAliExpressOrder({ items: [{ supplier: 'aliexpress' }, { fulfillmentProvider: 'aliexpress' }] }), true);
  assert.equal(isAliExpressOrder({ items: [{ supplier: 'cj' }] }), false);
});
