const test = require('node:test');
const assert = require('node:assert/strict');
const { enabled } = require('../api/_lib/manual-aliexpress-fulfillment');

test('manual AliExpress fulfillment is available by default and can be explicitly disabled', () => {
  const previous = process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED;
  delete process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED;
  try {
    assert.equal(enabled(), true);
    process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED = 'false';
    assert.equal(enabled(), false);
    process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED = 'true';
    assert.equal(enabled(), true);
  } finally {
    if (previous === undefined) delete process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED;
    else process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED = previous;
  }
});

