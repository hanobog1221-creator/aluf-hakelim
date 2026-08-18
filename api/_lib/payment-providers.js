const { readPayPalRuntimeCredentials } = require('./provider-credentials');

const PAYPAL = 'paypal';
const ROUTE_B_INTERMEDIARY = 'route_b_intermediary';

function selectedPaymentProvider(env = process.env) {
  const id = String(env.PAYMENT_PROVIDER || PAYPAL).trim().toLowerCase();
  if (![PAYPAL, ROUTE_B_INTERMEDIARY].includes(id)) throw new Error('payment_provider_invalid');
  return id;
}

async function providerStatuses() {
  const paypal = await readPayPalRuntimeCredentials().catch(() => null);
  const paypalEnvironment = String(paypal?.environment || 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
  return [
    {
      id: PAYPAL,
      label: 'PayPal',
      enabled: true,
      configured: paypal?.configured === true,
      environment: paypalEnvironment,
      live: paypal?.configured === true && paypalEnvironment === 'live',
      credentialSource: paypal?.source || 'none'
    },
    {
      id: ROUTE_B_INTERMEDIARY,
      label: 'Route B intermediary',
      enabled: false,
      configured: false,
      environment: 'disabled',
      live: false,
      credentialSource: 'none',
      status: 'provider_approval_and_api_credentials_required'
    }
  ];
}

async function selectedProviderStatus() {
  const selected = selectedPaymentProvider();
  const statuses = await providerStatuses();
  return { selected, status: statuses.find((provider) => provider.id === selected) };
}

module.exports = {
  PAYPAL,
  ROUTE_B_INTERMEDIARY,
  selectedPaymentProvider,
  providerStatuses,
  selectedProviderStatus
};
