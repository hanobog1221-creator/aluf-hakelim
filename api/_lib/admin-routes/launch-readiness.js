const { requireAdmin, config, dbHeaders } = require('../admin');
const { readProviderCredentials } = require('../provider-credentials');
const { sandboxMode, autoPayEnabled, getBalanceUsd } = require('../cj-fulfillment');

const EXPECTED_CRONS = new Map([
  ['cj-sourcing-hourly', '5 * * * *'],
  ['cj-catalog-hourly', '20 * * * *'],
  ['cj-sourcing-daily-retry', '35 0 * * *'],
  ['cj-orders-every-30m', '10,40 * * * *']
]);

function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function bool(value) { return value === true; }
function paypalEnvironment(stored) {
  const raw = clean(process.env.PAYPAL_ENVIRONMENT || process.env.PAYPAL_ENV || stored?.environment || 'sandbox', 20).toLowerCase();
  return raw === 'live' ? 'live' : 'sandbox';
}
function hasPayPalClientId(stored) { return Boolean(clean(process.env.PAYPAL_CLIENT_ID || stored?.client_id, 500)); }
function hasPayPalSecret(stored) { return Boolean(clean(process.env.PAYPAL_CLIENT_SECRET || stored?.client_secret, 500)); }
function hasCjApiKey(stored) { return Boolean(clean(process.env.CJ_API_KEY || stored?.api_key, 500)); }
function hasTracking(order) {
  if (clean(order?.tracking_number, 300)) return true;
  return Array.isArray(order?.tracking_numbers) && order.tracking_numbers.some((row) => clean(typeof row === 'string' ? row : (row?.number || row?.trackingNumber), 300));
}

async function dbJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`readiness_db_${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const { supabaseUrl } = config();
    const headers = dbHeaders();
    const [settingsRows, readinessRows, orders, attempts, cronRows, paypalStored, cjStored] = await Promise.all([
      dbJson(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled,minimum_profit_ils,payment_quote_ttl_minutes,business_legal_name,business_tax_id,business_type,business_address,business_phone,support_email&limit=1`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/product_fulfillment_readiness?select=id,name,active,supplier,ready_for_paid_order,blockers,last_sync_at,shipping_last_checked_at&order=id.asc`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/orders?select=order_id,status,payment_status,fulfillment_status,supplier_order_id,tracking_number,tracking_numbers,created_at,updated_at&order=created_at.desc&limit=60`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/supplier_order_attempts?select=order_id,provider,status,provider_sandbox,provider_payment_completed,supplier_order_ids,created_at&order=created_at.desc&limit=60`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/rpc/get_launch_cron_status`, {
        method: 'POST', headers: dbHeaders({ 'Content-Type': 'application/json' }), body: '{}'
      }),
      readProviderCredentials('paypal').catch(() => null),
      readProviderCredentials('cj').catch(() => null)
    ]);

    const settings = settingsRows[0] || {};
    const activeRows = readinessRows.filter((row) => bool(row.active));
    const readyRows = activeRows.filter((row) => bool(row.ready_for_paid_order));
    const blockedRows = activeRows.filter((row) => !bool(row.ready_for_paid_order));
    const aliBlockedRows = blockedRows.filter((row) => clean(row.supplier, 30).toLowerCase() === 'aliexpress');
    const nonAliBlockedRows = blockedRows.filter((row) => clean(row.supplier, 30).toLowerCase() !== 'aliexpress');

    const attemptByOrder = new Map();
    for (const attempt of attempts) {
      if (!attemptByOrder.has(String(attempt.order_id))) attemptByOrder.set(String(attempt.order_id), attempt);
    }
    const sandboxOrders = orders.filter((order) => /^AH-SBX-PAY-/i.test(String(order.order_id || '')));
    const sandboxE2EOrder = sandboxOrders.find((order) => {
      const attempt = attemptByOrder.get(String(order.order_id));
      return order.payment_status === 'paid'
        && Boolean(order.supplier_order_id)
        && attempt?.provider === 'cj'
        && attempt?.provider_sandbox === true
        && attempt?.provider_payment_completed === true
        && ['paid', 'shipped', 'delivered'].includes(String(attempt?.status || '').toLowerCase());
    }) || null;
    const trackingOrder = orders.find((order) => /^AH-SBX-/i.test(String(order.order_id || ''))
      && ['shipped', 'completed'].includes(String(order.status || '').toLowerCase())
      && hasTracking(order)) || null;

    const cronState = cronRows.map((row) => ({
      jobname: clean(row.jobname, 80),
      schedule: clean(row.schedule, 80),
      active: row.active === true,
      expected: EXPECTED_CRONS.get(clean(row.jobname, 80)) || null
    }));
    const workersReady = EXPECTED_CRONS.size === cronState.length
      && cronState.every((row) => row.active && row.expected === row.schedule);

    const ppEnv = paypalEnvironment(paypalStored);
    const paypalConfigured = hasPayPalClientId(paypalStored) && hasPayPalSecret(paypalStored);
    const paypalLiveReady = paypalConfigured && ppEnv === 'live';
    const cjConfigured = hasCjApiKey(cjStored);
    const cjSandbox = sandboxMode();
    const cjAutoPay = autoPayEnabled();
    let cjBalanceUsd = null;
    let cjBalanceOk = false;
    if (cjConfigured) {
      try {
        cjBalanceUsd = await getBalanceUsd();
        cjBalanceOk = Number(cjBalanceUsd) > 0;
      } catch {}
    }
    const cjLiveReady = cjConfigured && !cjSandbox && cjAutoPay && cjBalanceOk;

    const minimumProfit = Number(settings.minimum_profit_ils);
    const quoteTtl = Number(settings.payment_quote_ttl_minutes);
    const guardsReady = Number.isFinite(minimumProfit) && minimumProfit > 0
      && Number.isInteger(quoteTtl) && quoteTtl >= 5 && quoteTtl <= 180;
    const businessReady = Boolean(
      clean(settings.business_legal_name, 200)
      && clean(settings.business_tax_id, 60)
      && ['exempt', 'authorized', 'company'].includes(clean(settings.business_type, 30).toLowerCase())
      && clean(settings.business_address, 300)
      && clean(settings.business_phone, 60)
    );

    const engineeringReady = readyRows.length > 0
      && nonAliBlockedRows.length === 0
      && Boolean(sandboxE2EOrder)
      && Boolean(trackingOrder)
      && workersReady
      && guardsReady;
    const liveProvidersReady = paypalLiveReady && cjLiveReady;
    const canEnableSales = engineeringReady && liveProvidersReady && businessReady;
    const fullCatalogReady = activeRows.length > 0 && blockedRows.length === 0;
    const aliOnlyCatalogBlocker = aliBlockedRows.length > 0 && nonAliBlockedRows.length === 0;

    const blockers = [];
    if (!readyRows.length) blockers.push('no_purchase_ready_products');
    if (nonAliBlockedRows.length) blockers.push('non_aliexpress_product_blockers');
    if (!sandboxE2EOrder) blockers.push('paypal_to_cj_sandbox_e2e_not_verified');
    if (!trackingOrder) blockers.push('tracking_e2e_not_verified');
    if (!workersReady) blockers.push('automation_workers_not_ready');
    if (!guardsReady) blockers.push('checkout_guards_not_ready');
    if (!paypalLiveReady) blockers.push('paypal_live_credentials_required');
    if (!cjLiveReady) {
      if (cjSandbox) blockers.push('cj_live_mode_required');
      if (!cjAutoPay) blockers.push('cj_autopay_required');
      if (!cjBalanceOk) blockers.push('cj_positive_balance_required');
    }
    if (!businessReady) blockers.push('business_identity_required_for_live_sales');
    if (aliBlockedRows.length) blockers.push('aliexpress_catalog_permission_or_sync_pending');
    if (settings.sales_enabled !== true) blockers.push('sales_switch_off');

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      phase: {
        engineeringReady,
        liveProvidersReady,
        businessReady,
        canEnableSales,
        salesEnabled: settings.sales_enabled === true,
        fullCatalogReady,
        aliOnlyCatalogBlocker
      },
      catalog: {
        active: activeRows.length,
        ready: readyRows.length,
        blocked: blockedRows.length,
        aliexpressBlocked: aliBlockedRows.map((row) => ({ id: row.id, name: row.name, blockers: Array.isArray(row.blockers) ? row.blockers : [] })),
        nonAliexpressBlocked: nonAliBlockedRows.map((row) => ({ id: row.id, name: row.name, supplier: row.supplier, blockers: Array.isArray(row.blockers) ? row.blockers : [] })),
        readyProducts: readyRows.map((row) => ({ id: row.id, name: row.name, supplier: row.supplier }))
      },
      payments: {
        sandboxE2EVerified: Boolean(sandboxE2EOrder),
        sandboxE2EOrderId: sandboxE2EOrder?.order_id || null,
        paypalConfigured,
        paypalEnvironment: ppEnv,
        paypalLiveReady
      },
      fulfillment: {
        trackingE2EVerified: Boolean(trackingOrder),
        trackingE2EOrderId: trackingOrder?.order_id || null,
        cjConfigured,
        cjSandbox,
        cjAutoPay,
        cjBalanceUsd,
        cjBalanceOk,
        cjLiveReady
      },
      automation: { workersReady, jobs: cronState },
      guards: {
        minimumProfitIls: Number.isFinite(minimumProfit) ? minimumProfit : null,
        paymentQuoteTtlMinutes: Number.isInteger(quoteTtl) ? quoteTtl : null,
        ready: guardsReady
      },
      business: {
        ready: businessReady,
        legalNameSet: Boolean(clean(settings.business_legal_name, 200)),
        taxIdSet: Boolean(clean(settings.business_tax_id, 60)),
        type: clean(settings.business_type, 30) || null,
        addressSet: Boolean(clean(settings.business_address, 300)),
        phoneSet: Boolean(clean(settings.business_phone, 60)),
        supportEmailSet: Boolean(clean(settings.support_email, 200))
      },
      blockers
    });
  } catch (error) {
    console.error('Launch readiness failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message || error, 220) || 'launch_readiness_failed' });
  }
};
