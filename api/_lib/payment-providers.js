const { readPayPalRuntimeCredentials } = require('./provider-credentials');

const PAYPAL = 'paypal';
const WHOP = 'whop';
const ROUTE_B_INTERMEDIARY = 'route_b_intermediary';
const FOURTHWALL_MOR = 'fourthwall_mor';

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
    match: 'strongest_current_mor_candidate',
    pricing: 'self_sourced_products_zero_platform_fee_plus_payment_processing',
    fulfillment: 'external_self_fulfillment_with_tracking_supported',
    legalModel: 'merchant_of_record_for_checkout_taxes',
    onboarding: 'account_created_payout_verification_and_product_approval_required',
    url: 'https://fourthwall.com/pricing'
  }
]);

function selectedPaymentProvider(env = process.env) {
  const explicit = String(env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  const id = explicit || (whopProviderStatus(env).configured ? WHOP : PAYPAL);
  if (![PAYPAL, WHOP, ROUTE_B_INTERMEDIARY, FOURTHWALL_MOR].includes(id)) throw new Error('payment_provider_invalid');
  return id;
}

function whopProviderStatus(env = process.env) {
  const apiKeyPresent = Boolean(String(env.WHOP_API_KEY || '').trim());
  const webhookSecretPresent = Boolean(String(env.WHOP_WEBHOOK_SECRET || '').trim());
  const companyIdPresent = /^biz_[A-Za-z0-9]+$/.test(String(env.WHOP_COMPANY_ID || '').trim());
  const configured = apiKeyPresent && webhookSecretPresent && companyIdPresent;
  return {
    id: WHOP,
    label: 'Whop Checkout',
    enabled: true,
    configured,
    environment: 'live',
    live: configured,
    credentialSource: configured ? 'environment' : 'none',
    status: configured ? 'ready' : 'api_key_company_id_and_webhook_secret_required'
  };
}

function fourthwallProviderStatus(env = process.env) {
  const approved = String(env.FOURTHWALL_APPROVED || '').trim().toLowerCase() === 'true';
  const apiKeyPresent = Boolean(String(env.FOURTHWALL_API_KEY || '').trim());
  const webhookSecretPresent = Boolean(String(env.FOURTHWALL_WEBHOOK_SECRET || '').trim());
  const shopUrlPresent = /^https:\/\/[^/]+\.fourthwall\.com\/?$/i.test(String(env.FOURTHWALL_SHOP_URL || '').trim());
  const configured = approved && apiKeyPresent && webhookSecretPresent && shopUrlPresent;

  return {
    id: FOURTHWALL_MOR,
    label: 'Fourthwall Merchant of Record',
    // Fail closed until the real checkout/webhook adapter is implemented and verified.
    enabled: false,
    configured,
    environment: 'disabled',
    live: false,
    credentialSource: configured ? 'environment' : 'none',
    status: configured
      ? 'adapter_implementation_and_webhook_verification_required'
      : approved
        ? 'api_credentials_and_shop_url_required'
        : 'payout_verification_and_written_product_approval_required'
  };
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
    },
    whopProviderStatus(),
    fourthwallProviderStatus()
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
  WHOP,
  ROUTE_B_INTERMEDIARY,
  FOURTHWALL_MOR,
  selectedPaymentProvider,
  whopProviderStatus,
  fourthwallProviderStatus,
  providerStatuses,
  selectedProviderStatus,
  routeBCandidates
};
