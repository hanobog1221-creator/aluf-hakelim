const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectedPaymentProvider,
  providerStatuses,
  routeBCandidates,
  fourthwallProviderStatus
} = require('../api/_lib/payment-providers');

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

test('Fourthwall can be selected but remains fail-closed before approval and adapter verification', () => {
  assert.equal(selectedPaymentProvider({ PAYMENT_PROVIDER: 'fourthwall_mor' }), 'fourthwall_mor');
  const status = fourthwallProviderStatus({
    FOURTHWALL_APPROVED: 'true',
    FOURTHWALL_SHOP_URL: 'https://hanufa-shop.fourthwall.com',
    FOURTHWALL_API_KEY: 'test-key-not-a-real-credential',
    FOURTHWALL_WEBHOOK_SECRET: 'test-secret-not-a-real-credential'
  });
  assert.equal(status.configured, true);
  assert.equal(status.enabled, false);
  assert.equal(status.live, false);
  assert.equal(status.status, 'adapter_implementation_and_webhook_verification_required');
});

test('research candidates cannot process payments', () => {
  const candidates = routeBCandidates();
  assert.ok(candidates.length >= 6);
  assert.ok(candidates.some((candidate) => candidate.id === 'plusbase'));
  assert.ok(candidates.some((candidate) => candidate.id === 'chip_dropship'));
  assert.equal(candidates.find((candidate) => candidate.id === 'fourthwall').match, 'strongest_current_mor_candidate');
  assert.ok(candidates.every((candidate) => candidate.connectionState === 'research_only'));
  assert.ok(candidates.every((candidate) => candidate.canProcessPayments === false));
});
