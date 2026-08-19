const { requireAdmin, config, dbHeaders } = require('../admin');
const { readProviderCredentials, readPayPalRuntimeCredentials } = require('../provider-credentials');
const { sandboxMode, autoPayEnabled, getBalanceUsd } = require('../cj-fulfillment');
const { aliExpressCreateEnabled, aliExpressAutoPayAuthorized } = require('../aliexpress-fulfillment');
const { selectedPaymentProvider, providerStatuses } = require('../payment-providers');

const EXPECTED_CJ_CRONS = new Map([
  ['cj-sourcing-hourly', '5 * * * *'],
  ['cj-catalog-hourly', '20 * * * *'],
  ['cj-sourcing-daily-retry', '35 0 * * *'],
  ['cj-orders-every-30m', '10,40 * * * *']
]);
const ALIEXPRESS_CRON = { jobname: 'aliexpress-catalog-hourly', schedule: '12 * * * *' };
const SUPPLIER_OPTIMIZER_CRON = { jobname: 'supplier-optimizer-hourly', schedule: '25 * * * *' };

function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function bool(value) { return value === true; }
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
    const [settingsRows, readinessRows, orders, attempts, cronRows, refundRequests, refundExpenses, paypalRuntime, cjStored] = await Promise.all([
      dbJson(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled,minimum_profit_ils,supplier_optimizer_enabled,payment_quote_ttl_minutes,business_legal_name,business_tax_id,business_type,business_address,business_phone,support_email&limit=1`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/product_fulfillment_readiness?select=id,name,active,supplier,ready_for_paid_order,blockers,last_sync_at,shipping_last_checked_at&order=id.asc`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/orders?select=order_id,status,payment_status,fulfillment_status,supplier_order_id,tracking_number,tracking_numbers,created_at,updated_at&order=created_at.desc&limit=60`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/supplier_order_attempts?select=order_id,provider,status,provider_sandbox,provider_payment_completed,supplier_order_ids,created_at&order=created_at.desc&limit=60`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/rpc/get_launch_cron_status`, { method: 'POST', headers: dbHeaders({ 'Content-Type': 'application/json' }), body: '{}' }),
      dbJson(`${supabaseUrl}/rest/v1/payment_refund_requests?provider=eq.paypal&status=eq.completed&select=request_id,order_id,requested_amount,currency,provider_refund_id,status,created_at&order=created_at.desc&limit=30`, { headers }),
      dbJson(`${supabaseUrl}/rest/v1/business_expenses?source=eq.paypal_refund&category=eq.refund&select=order_id,amount,currency,source_key,created_at&order=created_at.desc&limit=60`, { headers }),
      readPayPalRuntimeCredentials().catch(() => null),
      readProviderCredentials('cj').catch(() => null)
    ]);

    const settings = settingsRows[0] || {};
    const activeRows = readinessRows.filter((row) => bool(row.active));
    const readyRows = activeRows.filter((row) => bool(row.ready_for_paid_order));
    const blockedRows = activeRows.filter((row) => !bool(row.ready_for_paid_order));
    const activeAliRows = activeRows.filter((row) => clean(row.supplier, 30).toLowerCase() === 'aliexpress');
    const activeCjRows = activeRows.filter((row) => clean(row.supplier, 30).toLowerCase() === 'cj');
    const aliBlockedRows = blockedRows.filter((row) => clean(row.supplier, 30).toLowerCase() === 'aliexpress');
    const nonAliBlockedRows = blockedRows.filter((row) => clean(row.supplier, 30).toLowerCase() !== 'aliexpress');

    const attemptByOrder = new Map();
    for (const attempt of attempts) if (!attemptByOrder.has(String(attempt.order_id))) attemptByOrder.set(String(attempt.order_id), attempt);
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
      && ['shipped', 'completed'].includes(String(order.status || '').toLowerCase()) && hasTracking(order)) || null;

    const refundExpenseByKey = new Map(refundExpenses.map((row) => [clean(row.source_key, 200), row]));
    const refundE2ERequest = refundRequests.find((row) => {
      const refundId = clean(row.provider_refund_id, 200);
      const expense = refundExpenseByKey.get(refundId);
      return /^AH-SBX-PAY-/i.test(String(row.order_id || '')) && refundId && expense
        && String(expense.order_id) === String(row.order_id)
        && clean(row.currency, 3).toUpperCase() === 'ILS'
        && clean(expense.currency, 3).toUpperCase() === 'ILS'
        && Number(row.requested_amount) > 0
        && Number(row.requested_amount) === Number(expense.amount);
    }) || null;

    const cronState = cronRows.map((row) => ({
      jobname: clean(row.jobname, 80),
      schedule: clean(row.schedule, 80),
      active: row.active === true
    }));
    const aliCron = cronState.find((row) => row.jobname === ALIEXPRESS_CRON.jobname) || null;
    const aliExpressWorkerReady = Boolean(aliCron?.active && aliCron.schedule === ALIEXPRESS_CRON.schedule);
    const optimizerCron = cronState.find((row) => row.jobname === SUPPLIER_OPTIMIZER_CRON.jobname) || null;
    const supplierOptimizerWorkerReady = settings.supplier_optimizer_enabled !== true
      || Boolean(optimizerCron?.active && optimizerCron.schedule === SUPPLIER_OPTIMIZER_CRON.schedule);
    const cjWorkersReady = activeCjRows.length === 0 || (
      EXPECTED_CJ_CRONS.size === cronState.filter((row) => EXPECTED_CJ_CRONS.has(row.jobname)).length
      && [...EXPECTED_CJ_CRONS.entries()].every(([jobname, schedule]) => {
        const row = cronState.find((item) => item.jobname === jobname);
        return row?.active === true && row.schedule === schedule;
      })
    );
    const workersReady = aliExpressWorkerReady && cjWorkersReady && supplierOptimizerWorkerReady;

    const ppEnv = clean(paypalRuntime?.environment || 'sandbox', 20).toLowerCase() === 'live' ? 'live' : 'sandbox';
    const paypalConfigured = paypalRuntime?.configured === true;
    const paypalLiveReady = paypalConfigured && ppEnv === 'live';
    const paymentProvider = selectedPaymentProvider();
    const paymentProviders = await providerStatuses();
    const activePaymentProvider = paymentProviders.find((provider) => provider.id === paymentProvider);
    const paymentProviderLiveReady = activePaymentProvider?.enabled === true && activePaymentProvider?.live === true;

    const cjConfigured = hasCjApiKey(cjStored);
    const cjSandbox = sandboxMode();
    const cjAutoPay = autoPayEnabled();
    let cjBalanceUsd = null;
    let cjBalanceOk = false;
    if (activeCjRows.length && cjConfigured) {
      try { cjBalanceUsd = await getBalanceUsd(); cjBalanceOk = Number(cjBalanceUsd) > 0; } catch {}
    }
    const cjLiveReady = activeCjRows.length === 0 || (cjConfigured && !cjSandbox && cjAutoPay && cjBalanceOk);
    const aliExpressOrderCreationReady = activeAliRows.length === 0 || aliExpressCreateEnabled();
    const aliExpressAutoPay = aliExpressAutoPayAuthorized();

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

    const fullCatalogReady = activeRows.length > 0 && blockedRows.length === 0;
    const engineeringReady = fullCatalogReady
      && Boolean(sandboxE2EOrder)
      && Boolean(trackingOrder)
      && Boolean(refundE2ERequest)
      && workersReady
      && guardsReady
      && aliExpressOrderCreationReady;
    const liveProvidersReady = paymentProviderLiveReady && aliExpressOrderCreationReady && cjLiveReady;
    const canEnableSales = engineeringReady && liveProvidersReady && businessReady;
    const aliOnlyCatalogBlocker = aliBlockedRows.length > 0 && nonAliBlockedRows.length === 0;

    const blockers = [];
    if (!readyRows.length) blockers.push('no_purchase_ready_products');
    if (blockedRows.length) blockers.push('catalog_product_blockers');
    if (!sandboxE2EOrder) blockers.push('paypal_sandbox_e2e_not_verified');
    if (!trackingOrder) blockers.push('tracking_e2e_not_verified');
    if (!refundE2ERequest) blockers.push('paypal_refund_e2e_not_verified');
    if (!aliExpressWorkerReady && activeAliRows.length) blockers.push('aliexpress_catalog_worker_not_ready');
    if (!cjWorkersReady && activeCjRows.length) blockers.push('cj_automation_workers_not_ready');
    if (!guardsReady) blockers.push('checkout_guards_not_ready');
    if (!aliExpressOrderCreationReady) blockers.push('aliexpress_order_creation_disabled');
    if (!paymentProviderLiveReady) blockers.push('payment_provider_live_credentials_required');
    if (activeCjRows.length && !cjLiveReady) {
      if (cjSandbox) blockers.push('cj_live_mode_required');
      if (!cjAutoPay) blockers.push('cj_autopay_required');
      if (!cjBalanceOk) blockers.push('cj_positive_balance_required');
    }
    if (!businessReady) blockers.push('business_identity_required_for_live_sales');
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
        activeAliExpress: activeAliRows.length,
        activeCj: activeCjRows.length,
        aliexpressBlocked: aliBlockedRows.map((row) => ({ id: row.id, name: row.name, blockers: Array.isArray(row.blockers) ? row.blockers : [] })),
        nonAliexpressBlocked: nonAliBlockedRows.map((row) => ({ id: row.id, name: row.name, supplier: row.supplier, blockers: Array.isArray(row.blockers) ? row.blockers : [] })),
        readyProducts: readyRows.map((row) => ({ id: row.id, name: row.name, supplier: row.supplier }))
      },
      payments: {
        sandboxE2EVerified: Boolean(sandboxE2EOrder),
        sandboxE2EOrderId: sandboxE2EOrder?.order_id || null,
        refundE2EVerified: Boolean(refundE2ERequest),
        refundE2EOrderId: refundE2ERequest?.order_id || null,
        paypalConfigured,
        paypalEnvironment: ppEnv,
        paypalCredentialSource: paypalRuntime?.source || 'none',
        paypalLiveReady,
        selectedProvider: paymentProvider,
        selectedProviderLiveReady: paymentProviderLiveReady,
        providers: paymentProviders
      },
      fulfillment: {
        trackingE2EVerified: Boolean(trackingOrder),
        trackingE2EOrderId: trackingOrder?.order_id || null,
        aliExpressOrderCreationReady,
        aliExpressAutoPay,
        activeAliExpressProducts: activeAliRows.length,
        activeCjProducts: activeCjRows.length,
        cjConfigured,
        cjSandbox,
        cjAutoPay,
        cjBalanceUsd,
        cjBalanceOk,
        cjLiveReady
      },
      automation: { workersReady, aliExpressWorkerReady, cjWorkersReady, supplierOptimizerWorkerReady, jobs: cronState },
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
