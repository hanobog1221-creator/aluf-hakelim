const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLACE_ORDER_METHOD,
  PLACE_ORDER_PARAM,
  aliExpressCreateEnabled,
  aliExpressAutoPayAuthorized,
  aliExpressLiveAutomationReady
} = require('../api/_lib/aliexpress-fulfillment');

test('AliExpress paid-order creation defaults on with an emergency kill switch', () => {
  const oldCreate = process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
  const oldPay = process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
  delete process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
  delete process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
  try {
    assert.equal(aliExpressCreateEnabled(), true);
    assert.equal(aliExpressAutoPayAuthorized(), false);
    assert.equal(aliExpressLiveAutomationReady(), true);
  } finally {
    if (oldCreate === undefined) delete process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
    else process.env.ALIEXPRESS_ORDER_CREATE_ENABLED = oldCreate;
    if (oldPay === undefined) delete process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
    else process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED = oldPay;
  }
});

test('AliExpress order creation can be explicitly disabled without enabling supplier auto-pay', () => {
  const oldCreate = process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
  const oldPay = process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
  process.env.ALIEXPRESS_ORDER_CREATE_ENABLED = 'false';
  process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED = 'false';
  try {
    assert.equal(aliExpressCreateEnabled(), false);
    assert.equal(aliExpressAutoPayAuthorized(), false);
    assert.equal(aliExpressLiveAutomationReady(), false);
  } finally {
    if (oldCreate === undefined) delete process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
    else process.env.ALIEXPRESS_ORDER_CREATE_ENABLED = oldCreate;
    if (oldPay === undefined) delete process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
    else process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED = oldPay;
  }
});

test('uses the documented AliExpress place-order method and request parameter', () => {
  assert.equal(PLACE_ORDER_METHOD, 'aliexpress.trade.buy.placeorder');
  assert.equal(PLACE_ORDER_PARAM, 'param_place_order_request4_open_api_d_t_o');
});
