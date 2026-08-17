const test = require('node:test');
const assert = require('node:assert/strict');
const { aliExpressCreateEnabled, aliExpressAutoPayAuthorized } = require('../api/_lib/aliexpress-fulfillment');

test('AliExpress supplier creation and payment default to disabled', () => {
  const oldCreate = process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
  const oldPay = process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
  delete process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
  delete process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
  try {
    assert.equal(aliExpressCreateEnabled(), false);
    assert.equal(aliExpressAutoPayAuthorized(), false);
  } finally {
    if (oldCreate === undefined) delete process.env.ALIEXPRESS_ORDER_CREATE_ENABLED;
    else process.env.ALIEXPRESS_ORDER_CREATE_ENABLED = oldCreate;
    if (oldPay === undefined) delete process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED;
    else process.env.ALIEXPRESS_AUTO_PAY_AUTHORIZED = oldPay;
  }
});
