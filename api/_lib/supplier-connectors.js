const CONNECTORS = Object.freeze({
  cj: Object.freeze({
    id: 'cj', name: 'CJdropshipping', hosts: ['cjdropshipping.com'], access: 'self_service_api_key',
    documentationUrl: 'https://developers.cjdropshipping.com/en/api/api2/api/auth.html',
    registrationUrl: 'https://cjdropshipping.com/register.html',
    supportsIsrael: true, credentialFields: ['api_key'], apiVerificationSupported: true
  }),
  hypersku: Object.freeze({
    id: 'hypersku', name: 'HyperSKU', hosts: ['hypersku.com'], access: 'open_api_approval',
    documentationUrl: 'https://support.hypersku.com/en/articles/2941652-what-s-hypersku-how-to-sign-up-and-get-started',
    supportsIsrael: true, credentialFields: ['api_key', 'client_id', 'client_secret'], apiVerificationSupported: false
  }),
  banggood: Object.freeze({
    id: 'banggood', name: 'Banggood', hosts: ['banggood.com'], access: 'dropship_api_account',
    documentationUrl: 'https://uk.banggood.com/index.php?com=account&t=dropshipGuidance',
    supportsIsrael: true, credentialFields: ['api_key', 'client_secret'], apiVerificationSupported: false
  }),
  eprolo: Object.freeze({
    id: 'eprolo', name: 'EPROLO', hosts: ['eprolo.com'], access: 'api_document_by_agent',
    documentationUrl: 'https://eprolo.com/eprolo-api/',
    supportsIsrael: null, credentialFields: ['api_key', 'client_id', 'client_secret'], apiVerificationSupported: false
  }),
  wiio: Object.freeze({
    id: 'wiio', name: 'Wiio', hosts: ['wiio.io', 'wiio.com'], access: 'account_agent_quote',
    documentationUrl: 'https://wiio.com/faq-2/',
    supportsIsrael: null, credentialFields: ['api_key', 'client_id', 'client_secret'], apiVerificationSupported: false
  })
});

const CONNECTOR_IDS = Object.freeze(Object.keys(CONNECTORS));

function connectorDefinition(value) {
  return CONNECTORS[String(value || '').trim().toLowerCase()] || null;
}

function hasCredential(row) {
  return Boolean(String(row?.api_key || row?.client_id || '').trim())
    && Boolean(String(row?.client_secret || row?.api_key || '').trim());
}

function publicConnectorStatus(row, id) {
  const definition = connectorDefinition(id);
  if (!definition) return null;
  const configured = hasCredential(row);
  const apiVerified = row?.api_verified === true;
  const orderVerified = row?.order_verified === true;
  return {
    ...definition,
    configured,
    apiVerified,
    orderVerified,
    enabled: row?.enabled === true && configured && apiVerified && orderVerified,
    updatedAt: row?.updated_at || null,
    lastError: String(row?.last_error || '').trim().slice(0, 220) || null
  };
}

module.exports = { CONNECTORS, CONNECTOR_IDS, connectorDefinition, hasCredential, publicConnectorStatus };
