const test = require('node:test');
const assert = require('node:assert/strict');
const { CONNECTOR_IDS, connectorDefinition, publicConnectorStatus } = require('../api/_lib/supplier-connectors');

test('registers CJ and all four additional suppliers', () => {
  assert.deepEqual(CONNECTOR_IDS, ['cj', 'hypersku', 'banggood', 'eprolo', 'wiio']);
  for (const id of CONNECTOR_IDS) assert.equal(connectorDefinition(id).id, id);
});

test('only exposes automatic API verification for the implemented CJ adapter', () => {
  assert.equal(connectorDefinition('cj').apiVerificationSupported, true);
  assert.equal(connectorDefinition('banggood').apiVerificationSupported, false);
});

test('fails closed until credentials, API and a real order are verified', () => {
  assert.equal(publicConnectorStatus({}, 'hypersku').enabled, false);
  assert.equal(publicConnectorStatus({ api_key: 'key', enabled: true, api_verified: true, order_verified: false }, 'hypersku').enabled, false);
  assert.equal(publicConnectorStatus({ api_key: 'key', enabled: true, api_verified: true, order_verified: true }, 'hypersku').enabled, true);
});

test('does not expose stored credential values in public status', () => {
  const status = publicConnectorStatus({ api_key: 'top-secret', client_secret: 'secret', enabled: false }, 'banggood');
  assert.equal(status.configured, true);
  assert.equal('api_key' in status, false);
  assert.equal('client_secret' in status, false);
});
