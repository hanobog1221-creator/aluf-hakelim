const { serverConfig, serverHeaders } = require('../api/_lib/supabase-server');
const { productAutomationStatus } = require('../api/_lib/product-readiness');
const { selectedPaymentProvider, providerStatuses } = require('../api/_lib/payment-providers');
const cjWorker = require('../api/_lib/admin-routes/cj-worker-catalog');
const aliWorker = require('../api/aliexpress/catalog-worker');

const CANDIDATE_IDS = [
  'ae-1005009577109019','ae-1005012832500138','cj-car-mop','cj-detail-brush',
  'cj-k5-bits','cj-kw310-obd','cj-magnetic-ring','cj-microfiber-towel',
  'cj-phone-holder','cj-silicone-squeegee','cj-tire-gauge','cj-wash-mitt',
  'ratchet','socket','washer'
];

async function db(path, options = {}) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, options);
  if (!response.ok) throw new Error(`manual_launch_db_${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function workerResponse() {
  const state = { statusCode: 200, body: null };
  return { state, setHeader() {}, status(code) { state.statusCode = code; return this; }, json(body) { state.body = body; return body; } };
}

async function runWorker(handler, query = {}) {
  const res = workerResponse();
  await handler({ method: 'GET', query, headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` } }, res);
  if (res.state.statusCode !== 200 || res.state.body?.ok !== true) throw new Error(`manual_launch_worker_${res.state.statusCode}`);
  return res.state.body;
}

async function main() {
  const approved = 'Launch approved manual supplier payment sales';
  if (process.env.VERCEL_ENV !== 'production' || process.env.VERCEL_GIT_COMMIT_MESSAGE !== approved) {
    console.log('One-time manual sales launch skipped for this deployment.');
    return;
  }
  const writeHeaders = serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  await db('site_settings?id=eq.primary', { method: 'PATCH', headers: writeHeaders, body: JSON.stringify({ sales_enabled: false }) });
  for (const id of CANDIDATE_IDS) {
    await db(`products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: writeHeaders, body: JSON.stringify({ active: true }) });
  }
  await runWorker(cjWorker, { discover: 'false' });
  await runWorker(aliWorker);
  const readHeaders = serverHeaders();
  const [settingsRows, products] = await Promise.all([
    db('site_settings?id=eq.primary&select=*&limit=1', { headers: readHeaders }),
    db(`products?id=in.(${encodeURIComponent(CANDIDATE_IDS.join(','))})&select=*`, { headers: readHeaders })
  ]);
  const settings = settingsRows[0] || {};
  const evaluated = products.map((product) => ({ product, status: productAutomationStatus(product, settings) }));
  const kept = evaluated.filter((row) => row.status.ready);
  const removed = evaluated.filter((row) => !row.status.ready);
  for (const row of removed) {
    await db(`products?id=eq.${encodeURIComponent(row.product.id)}`, { method: 'PATCH', headers: writeHeaders, body: JSON.stringify({ active: false }) });
  }
  const provider = selectedPaymentProvider();
  const payment = (await providerStatuses()).find((row) => row.id === provider);
  const salesEnabled = kept.length > 0 && provider === 'whop' && payment?.enabled === true && payment?.live === true;
  await db('site_settings?id=eq.primary', { method: 'PATCH', headers: writeHeaders, body: JSON.stringify({ sales_enabled: salesEnabled }) });
  console.log(JSON.stringify({
    manualSalesLaunch: true,
    salesEnabled,
    paymentProvider: provider,
    paymentLive: payment?.live === true,
    keptProductIds: kept.map((row) => row.product.id),
    removedProductIds: removed.map((row) => row.product.id)
  }));
}

main().catch((error) => {
  console.error(`Manual sales launch failed: ${String(error.message || error).slice(0, 180)}`);
  process.exitCode = 1;
});
