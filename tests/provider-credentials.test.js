const test = require('node:test');
const assert = require('node:assert/strict');
const { choosePayPalCredentials } = require('../api/_lib/provider-credentials');

test('verified stored PayPal credentials take priority over deployment environment values', () => {
  const runtime = choosePayPalCredentials({
    client_id: 'stored-live-client-id-1234567890',
    client_secret: 'stored-live-secret-1234567890',
    environment: 'live',
    updated_at: '2026-08-18T07:00:00Z'
  }, {
    PAYPAL_CLIENT_ID: 'old-sandbox-client-id-1234567890',
    PAYPAL_CLIENT_SECRET: 'old-sandbox-secret-1234567890',
    PAYPAL_ENVIRONMENT: 'sandbox'
  });
  assert.equal(runtime.configured, true);
  assert.equal(runtime.source, 'stored');
  assert.equal(runtime.environment, 'live');
  assert.equal(runtime.clientId, 'stored-live-client-id-1234567890');
});

test('deployment environment is a fallback only when no complete stored pair exists', () => {
  const runtime = choosePayPalCredentials({ client_id: 'partial-only', client_secret: null, environment: 'live' }, {
    PAYPAL_CLIENT_ID: 'env-client-id-123456789012345',
    PAYPAL_CLIENT_SECRET: 'env-secret-123456789012345',
    PAYPAL_ENVIRONMENT: 'sandbox'
  });
  assert.equal(runtime.configured, true);
  assert.equal(runtime.source, 'environment');
  assert.equal(runtime.environment, 'sandbox');
});

test('environment normalization fails closed to sandbox', () => {
  const runtime = choosePayPalCredentials({
    client_id: 'stored-client-id-1234567890123',
    client_secret: 'stored-secret-1234567890123',
    environment: 'production-ish'
  }, {});
  assert.equal(runtime.environment, 'sandbox');
});
