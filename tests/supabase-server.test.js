const test = require('node:test');
const assert = require('node:assert/strict');

const {
  keyKind,
  apiKeyHeaders,
  assertServerOnlyKey,
  serverHeaders
} = require('../api/_lib/supabase-server');

function fakeJwt(role) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role })}.signature`;
}

test('modern secret key is accepted server-side without Bearer JWT header', () => {
  const key = 'sb_secret_example';
  assert.equal(keyKind(key), 'secret');
  assert.equal(assertServerOnlyKey(key), 'secret');
  const headers = serverHeaders({ 'Content-Type': 'application/json' }, key);
  assert.equal(headers.apikey, key);
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Authorization, undefined);
});

test('modern publishable key may be used for public reads but is rejected by privileged paths', () => {
  const key = 'sb_publishable_example';
  assert.equal(keyKind(key), 'publishable');
  const publicHeaders = apiKeyHeaders({}, key);
  assert.equal(publicHeaders.apikey, key);
  assert.equal(publicHeaders.Authorization, undefined);
  assert.throws(() => serverHeaders({}, key), /supabase_public_key_not_allowed_for_server/);
});

test('legacy service_role JWT is accepted and sent as Bearer', () => {
  const key = fakeJwt('service_role');
  assert.equal(keyKind(key), 'legacy_service_role');
  const headers = serverHeaders({}, key);
  assert.equal(headers.apikey, key);
  assert.equal(headers.Authorization, `Bearer ${key}`);
});

test('legacy anon JWT is rejected by privileged server paths', () => {
  const key = fakeJwt('anon');
  assert.equal(keyKind(key), 'legacy_anon');
  const publicHeaders = apiKeyHeaders({}, key);
  assert.equal(publicHeaders.Authorization, `Bearer ${key}`);
  assert.throws(() => assertServerOnlyKey(key), /supabase_public_key_not_allowed_for_server/);
});

test('unknown key formats fail closed for privileged paths', () => {
  assert.equal(keyKind('not-a-real-key'), 'unknown');
  assert.throws(() => serverHeaders({}, 'not-a-real-key'), /supabase_unrecognized_server_key/);
});
