const test = require('node:test');
const assert = require('node:assert/strict');
const { providerSet } = require('../api/_lib/paid-order-fulfillment');

test('detects a single AliExpress provider', () => {
  assert.deepEqual([...providerSet({ items: [{ supplier: 'aliexpress' }, { supplier: 'AliExpress' }] })], ['aliexpress']);
});

test('detects mixed providers instead of routing them incorrectly', () => {
  assert.equal(providerSet({ items: [{ supplier: 'aliexpress' }, { supplier: 'cj' }] }).size, 2);
});
