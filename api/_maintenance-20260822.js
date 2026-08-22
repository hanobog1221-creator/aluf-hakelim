const crypto = require('crypto');
const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { productAutomationStatus } = require('./_lib/product-readiness');
const { selectedPaymentProvider, providerStatuses } = require('./_lib/payment-providers');
const { sandboxMode, autoPayEnabled, getBalanceUsd } = require('./_lib/cj-fulfillment');
const { aliExpressCreateEnabled, aliExpressAutoPayAuthorized } = require('./_lib/aliexpress-fulfillment');
const cjWorker = require('./_lib/admin-routes/cj-worker-catalog');
const aliWorker = require('./aliexpress/catalog-worker');

function authorized(req) {
  const explicitExpected = Buffer.from(String(process.env.MAINTENANCE_TOKEN || ''));
  const explicitSupplied = Buffer.from(String(req.headers['x-maintenance-token'] || ''));
  const cronExpected = Buffer.from(String(process.env.CRON_SECRET || ''));
  const cronSupplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const explicitOk = explicitExpected.length >= 32 && explicitExpected.length === explicitSupplied.length && crypto.timingSafeEqual(explicitExpected, explicitSupplied);
  const cronOk = cronExpected.length >= 32 && cronExpected.length === cronSupplied.length && crypto.timingSafeEqual(cronExpected, cronSupplied);
  return explicitOk || cronOk;
}

async function db(path, options = {}) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, options);
  if (!response.ok) throw new Error(`maintenance_db_${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function workerResponse() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    setHeader() {},
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return body; }
  };
}

async function runWorker(handler, query = {}) {
  const res = workerResponse();
  await handler({ method: 'GET', query, headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` } }, res);
  return { status: res.state.statusCode, body: res.state.body };
}

async function prepare() {
  const headers = serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  await db('site_settings?id=eq.primary', {
    method: 'PATCH', headers,
    body: JSON.stringify({
      sales_enabled: false,
      minimum_profit_ils: 10,
      pricing_fee_percent: 5.2,
      pricing_fee_fixed_ils: 1.2,
      pricing_reserve_ils: 0,
      pricing_tax_reserve_percent: 0,
      pricing_insurance_reserve_percent: 0
    })
  });
  await db('products', { method: 'PATCH', headers, body: JSON.stringify({ minimum_profit: 10 }) });
  return { ok: true, salesEnabled: false, minimumProfitIls: 10, feePercent: 5.2, feeFixedIls: 1.2 };
}

async function catalogState() {
  const headers = serverHeaders();
  const [settingsRows, products] = await Promise.all([
    db('site_settings?id=eq.primary&select=*&limit=1', { headers }),
    db('products?select=*&order=id.asc', { headers })
  ]);
  const settings = settingsRows[0] || {};
  const rows = products.map((product) => ({ product, status: productAutomationStatus(product, settings) }));
  return { settings, rows };
}

async function finalize() {
  const { settings, rows } = await catalogState();
  const active = rows.filter(({ product }) => product.active === true);
  let cjAccountReady = active.every(({ product }) => String(product.supplier || '').toLowerCase() !== 'cj');
  let cjBalanceUsd = null;
  if (!cjAccountReady && !sandboxMode() && autoPayEnabled()) {
    try { cjBalanceUsd = await getBalanceUsd(); cjAccountReady = Number(cjBalanceUsd) > 0; } catch {}
  }
  const aliAccountReady = aliExpressCreateEnabled() && aliExpressAutoPayAuthorized();
  const evaluated = active.map(({ product, status }) => {
    const provider = String(product.supplier || '').toLowerCase();
    const accountReady = provider === 'cj' ? cjAccountReady : provider === 'aliexpress' ? aliAccountReady : false;
    return { product, ready: status.ready && accountReady, blockers: [...status.blockers, ...(accountReady ? [] : [`${provider || 'supplier'}_account_not_live_ready`])] };
  });
  const removed = evaluated.filter((row) => !row.ready);
  const headers = serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  for (const row of removed) {
    await db(`products?id=eq.${encodeURIComponent(row.product.id)}`, { method: 'PATCH', headers, body: JSON.stringify({ active: false, fulfillment_ready: false }) });
  }
  const kept = evaluated.filter((row) => row.ready);
  const providers = await providerStatuses();
  const provider = selectedPaymentProvider();
  const payment = providers.find((row) => row.id === provider);
  const businessReady = Boolean(settings.business_legal_name && settings.business_tax_id && settings.business_type && settings.business_address && settings.business_phone);
  const salesEnabled = kept.length > 0 && provider === 'whop' && payment?.enabled === true && payment?.live === true && businessReady;
  await db('site_settings?id=eq.primary', { method: 'PATCH', headers, body: JSON.stringify({ sales_enabled: salesEnabled }) });
  return {
    ok: true,
    salesEnabled,
    paymentProvider: provider,
    paymentLive: payment?.live === true,
    businessReady,
    cjAccountReady,
    cjBalancePositive: cjBalanceUsd == null ? null : Number(cjBalanceUsd) > 0,
    aliExpressAccountReady: aliAccountReady,
    kept: kept.map((row) => ({ id: row.product.id, name: row.product.name, supplier: row.product.supplier, price: row.product.selling_price })),
    removed: removed.map((row) => ({ id: row.product.id, name: row.product.name, supplier: row.product.supplier, blockers: [...new Set(row.blockers)] }))
  };
}

async function runApprovedSync() {
  const prepared = await prepare();
  const cj = await runWorker(cjWorker, { discover: 'false' });
  if (cj.status !== 200 || cj.body?.ok !== true) throw new Error(`cj_sync_failed_${cj.status}`);
  const aliexpress = await runWorker(aliWorker);
  if (aliexpress.status !== 200 || aliexpress.body?.ok !== true) throw new Error(`aliexpress_sync_failed_${aliexpress.status}`);
  const completed = await finalize();
  return { prepared, cj, aliexpress, completed };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const action = String(req.query?.action || 'status');
    if (action === 'prepare') return res.status(200).json(await prepare());
    if (action === 'cj') return res.status(200).json(await runWorker(cjWorker, { discover: 'false' }));
    if (action === 'aliexpress') return res.status(200).json(await runWorker(aliWorker));
    if (action === 'finalize') return res.status(200).json(await finalize());
    const { settings, rows } = await catalogState();
    return res.status(200).json({ ok: true, salesEnabled: settings.sales_enabled === true, active: rows.filter((row) => row.product.active === true).length, ready: rows.filter((row) => row.product.active === true && row.status.ready).length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 220) });
  }
};

module.exports.runApprovedSync = runApprovedSync;
