const test = require('node:test');
const assert = require('node:assert/strict');
const { selectedPaymentProvider, providerStatuses } = require('../api/_lib/payment-providers');

test('keeps PayPal as the backwards-compatible default provider', () => {
  assert.equal(selectedPaymentProvider({}), 'paypal');
});

test('Route B intermediary is present and fails closed', async () => {
  const statuses = await providerStatuses();
  const routeB = statuses.find((provider) => provider.id === 'route_b_intermediary');
  assert.equal(routeB.enabled, false);
  assert.equal(routeB.configured, false);
  assert.equal(routeB.live, false);
  assert.equal(routeB.credentialSource, 'none');
});

test('unknown providers are rejected', () => {
  assert.throws(() => selectedPaymentProvider({ PAYMENT_PROVIDER: 'invented' }), /payment_provider_invalid/);
});
