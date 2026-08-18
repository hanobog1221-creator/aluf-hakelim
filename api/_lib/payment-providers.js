const { readPayPalRuntimeCredentials } = require('./provider-credentials');

const PAYPAL = 'paypal';
const ROUTE_B_INTERMEDIARY = 'route_b_intermediary';

const ROUTE_B_CANDIDATES = Object.freeze([
  {
    id: 'plusbase',
    label: 'PlusBase',
    match: 'strong',
    pricing: 'free_plan_transaction_fees',
    fulfillment: 'aliexpress_cj_and_managed_catalog',
    legalModel: 'built_in_payments_not_confirmed_mor',
    onboarding: 'israel_individual_confirmation_required',
    url: 'https://www.plusbase.com/pricing'
  },
  {
    id: 'chip_dropship',
    label: 'Chip Dropship',
    match: 'strong_technical_weak_legal_terms',
    pricing: 'no_upfront_fee_starts_at_7_percent',
    fulfillment: 'aliexpress_and_managed_fulfillment',
    legalModel: 'seller_tax_responsibility_in_published_terms',
    onboarding: 'israel_individual_confirmation_required',
    url: 'https://www.chipchip.com/dropship'
  },
  {
    id: 'expandnow',
    label: 'ExpandNow',
    match: 'merchant_of_record_only',
    pricing: 'five_percent_per_sale_no_minimum',
    fulfillment: 'merchant_supplied_fulfillment_required',
    legalModel: 'merchant_of_record',
    onboarding: 'individual_and_dropshipping_approval_required',
    url: 'https://www.expandnow.com/pricing/'
  },
  {
    id: 'brikl',
    label: 'Brikl Launch',
    match: 'catalog_limited',
    pricing: 'three_point_five_percent_no_monthly_fee',
    fulfillment: 'managed_promotional_products_catalog',
    legalModel: 'merchant_of_record',
    onboarding: 'stripe_express_country_eligibility_required',
    url: 'https://brikl.com/pricing'
  },
  {
    id: 'reach',
    label: 'Reach',
    match: 'enterprise_mor',
    pricing: 'no_fixed_fee_or_monthly_minimum_quote_required',
    fulfillment: 'existing_fulfillment_required',
    legalModel: 'merchant_of_record',
    onboarding: 'business_underwriting_required',
    url: 'https://www.withreach.com/solutions/for-retail'
  },
  {
    id: 'fourthwall',
    label: 'Fourthwall',
    match: 'catalog_limited_creator_route',
    pricing: 'no_monthly_or_upfront_fee',
    fulfillment: 'managed_creator_merch_catalog',
    legalModel: 'merchant_of_record_for_checkout_taxes',
    onboarding: 'automotive_tools_not_supported',
    url: 'https://fourthwall.com/make-your-own'
  }
]);

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

function routeBCandidates() {
  return ROUTE_B_CANDIDATES.map((candidate) => ({
    ...candidate,
    connectionState: 'research_only',
    canProcessPayments: false,
    lastReviewed: '2026-08-18'
  }));
}

module.exports = {
  PAYPAL,
  ROUTE_B_INTERMEDIARY,
  selectedPaymentProvider,
  providerStatuses,
  selectedProviderStatus,
  routeBCandidates
};
