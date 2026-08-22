const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyWhopSignature, whopOrderId } = require('../api/_lib/whop-security');
const { _test: whopTest } = require('../api/whop');

function signedHeaders(body, secret, timestamp, id = 'msg_test123') {
  const signature = crypto.createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` };
}

test('verifies Whop signatures and rejects stale or modified payloads', () => {
  const now = 1_800_000_000_000;
  const timestamp = Math.floor(now / 1000);
  const body = JSON.stringify({ type: 'payment.succeeded' });
  const headers = signedHeaders(body, 'whsec_test_only', timestamp);
  assert.equal(verifyWhopSignature(body, headers, 'whsec_test_only', now), true);
  assert.equal(verifyWhopSignature(`${body} `, headers, 'whsec_test_only', now), false);
  assert.equal(verifyWhopSignature(body, headers, 'whsec_test_only', now + 301_000), false);
});

test('accepts only store order IDs from signed event metadata', () => {
  assert.equal(whopOrderId({ data: { metadata: { order_id: 'ah-abc12' } } }), 'AH-ABC12');
  assert.equal(whopOrderId({ data: { metadata: { order_id: '../bad' } } }), null);
});

test('accepts only HTTPS Whop checkout URLs', () => {
  assert.equal(whopTest.safePurchaseUrl('https://whop.com/checkout/plan_test?session=ch_test'), 'https://whop.com/checkout/plan_test?session=ch_test');
  assert.equal(whopTest.safePurchaseUrl('https://checkout.whop.com/test'), 'https://checkout.whop.com/test');
  assert.equal(whopTest.safePurchaseUrl('https://whop.com.example.test/steal'), null);
});
