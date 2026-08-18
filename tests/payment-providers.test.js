const test = require('node:test');
const assert = require('node:assert/strict');
const { selectedPaymentProvider, providerStatuses, routeBCandidates } = require('../api/_lib/payment-providers');

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

test('research candidates cannot process payments', () => {
  const candidates = routeBCandidates();
  assert.ok(candidates.length >= 6);
  assert.ok(candidates.some((candidate) => candidate.id === 'plusbase'));
  assert.ok(candidates.some((candidate) => candidate.id === 'chip_dropship'));
  assert.ok(candidates.every((candidate) => candidate.connectionState === 'research_only'));
  assert.ok(candidates.every((candidate) => candidate.canProcessPayments === false));
});
