const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildTopParams, signTop } = require('../api/_lib/aliexpress');
const { snapshotFromResult } = require('../api/aliexpress/product-v2')._test;

test('TOP signature sorts every system and business parameter by ASCII key order', () => {
  const params = { product_id: '32982857990', app_key: '12129701', method: 'aliexpress.ds.product.get', format: 'json' };
  const canonical = 'app_key12129701formatjsonmethodaliexpress.ds.product.getproduct_id32982857990';
  const expected = crypto.createHmac('md5', 'secret').update(canonical, 'utf8').digest('hex').toUpperCase();
  assert.equal(signTop(params, 'secret'), expected);
});

test('parses the documented product.get response and its nested SKU DTOs', () => {
  const snapshot = snapshotFromResult('32982857990', {
    ae_item_base_info_dto: { subject: 'Tool', product_status_type: 'onSelling' },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: [{
        id: 123,
        sku_stock: true,
        sku_available_stock: 7,
        offer_sale_price: '12.50',
        currency_code: 'USD',
        ae_sku_property_dtos: {
          ae_sku_property_d_t_o: [{ property_value_definition_name: 'Set 1' }]
        }
      }]
    }
  }, 'top_ds_product_get');
  assert.equal(snapshot.title, 'Tool');
  assert.deepEqual(snapshot.skus[0], {
    id: '123', label: 'Set 1', inStock: true, stock: 7, price: 12.5, currency: 'USD'
  });
});

test('product.get uses the TOP method, OAuth token as session, HMAC-MD5, and form-safe values', () => {
  const params = buildTopParams(
    'aliexpress.ds.product.get',
    { product_id: '32982857990', ship_to_country: 'IL', target_currency: 'USD', target_language: 'EN' },
    'session token+/=',
    'secret',
    new Date('2026-07-28T02:45:32.000Z')
  );
  assert.equal(params.method, 'aliexpress.ds.product.get');
  assert.equal(params.session, 'session token+/=');
  assert.equal(params.sign_method, 'hmac');
  assert.equal(params.timestamp, '2026-07-28 10:45:32');
  assert.match(params.sign, /^[A-F0-9]{32}$/);
  const encoded = new URLSearchParams(params).toString();
  assert.match(encoded, /session=session\+token%2B%2F%3D/);
  assert.match(encoded, /method=aliexpress.ds.product.get/);
});

