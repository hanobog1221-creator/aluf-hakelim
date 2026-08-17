const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildTopParams, signTop } = require('../api/_lib/aliexpress');
const { snapshotFromResult, selectSku } = require('../api/aliexpress/product-v2')._test;
const { freightDto } = require('../api/_lib/shipping');

test('migrated API signature sorts every system and business parameter by ASCII key order', () => {
  const params = { product_id: '32982857990', app_key: '12129701', method: 'aliexpress.ds.product.get', format: 'json' };
  const canonical = 'app_key12129701formatjsonmethodaliexpress.ds.product.getproduct_id32982857990';
  const expected = crypto.createHmac('sha256', 'secret').update(canonical, 'utf8').digest('hex').toUpperCase();
  assert.equal(signTop(params, 'secret'), expected);
});

test('freight request includes the selected AliExpress SKU', () => {
  assert.deepEqual(freightDto({
    productId: '1005012832500138', skuId: '12000050063719484', qty: 2,
    countryCode: 'IL', shipFromCountry: 'CN'
  }), {
    country_code: 'IL', product_id: '1005012832500138', sku_id: '12000050063719484',
    product_num: 2, send_goods_country_code: 'CN'
  });
});

test('automatically selects a unique SKU matching the stored variant label', () => {
  const snapshot = { skus: [
    { id: '1', label: 'Body only / no battery', inStock: true },
    { id: '2', label: '1 Battery 1 Charger', inStock: true }
  ] };
  assert.equal(selectSku(snapshot, { variant_label: '1 battery, 1 charger' }).id, '2');
});

test('selects the only available SKU without manual extraction', () => {
  const snapshot = { skus: [
    { id: '1', label: 'Red', inStock: false },
    { id: '2', label: 'Blue', inStock: true }
  ] };
  assert.equal(selectSku(snapshot, {}).id, '2');
});

test('fails closed when multiple SKUs are available and no variant is specified', () => {
  const snapshot = { skus: [
    { id: '1', label: 'EU', inStock: true },
    { id: '2', label: 'US', inStock: true }
  ] };
  assert.equal(selectSku(snapshot, {}), null);
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

test('product.get uses the sync method, OAuth token as session, HMAC-SHA256, and form-safe values', () => {
  const params = buildTopParams(
    'aliexpress.ds.product.get',
    { product_id: '32982857990', ship_to_country: 'IL', target_currency: 'USD', target_language: 'EN' },
    'session token+/=',
    'secret',
    new Date('2026-07-28T02:45:32.000Z')
  );
  assert.equal(params.method, 'aliexpress.ds.product.get');
  assert.equal(params.session, 'session token+/=');
  assert.equal(params.sign_method, 'sha256');
  assert.equal(params.timestamp, '1785206732000');
  assert.equal(params.simplify, 'true');
  assert.match(params.sign, /^[A-F0-9]{64}$/);
  const encoded = new URLSearchParams(params).toString();
  assert.match(encoded, /session=session\+token%2B%2F%3D/);
  assert.match(encoded, /method=aliexpress.ds.product.get/);
});


