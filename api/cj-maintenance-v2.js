const { config, dbHeaders } = require('./_lib/admin');
const { CJ_BASE, ensureAccessToken, createSourcing, querySourcing } = require('./_lib/cj');

const DAILY_LIMIT_ERROR = 'cj_api_1600000_Exceeded the daily source limit';
const KNOWN_SHORT_SOURCE_IMAGES = {
  '1005012879937902': 'https://i.ebayimg.com/images/g/~5AAAOSwX05h7pN9/s-l1600.jpg'
};

function clean(value, max = 300) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  return v.slice(0, max);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function utcDay(value = Date.now()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}
function cjOkay(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.success === false || json.result === false) return false;
  const code = Number(json.code);
  return !Number.isFinite(code) || [0, 200].includes(code);
}
async function cjCall(path, { method = 'GET', body } = {}) {
  const token = await ensureAccessToken();
  const headers = { Accept: 'application/json', 'CJ-Access-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${CJ_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await r.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  if (!r.ok || !cjOkay(json)) {
    const err = new Error(`cj_api_${json?.code ?? r.status}_${clean(json?.message || `http_${r.status}`)}`.slice(0, 400));
    err.cj = json;
    throw err;
  }
  return json;
}
async function dbGet(path) {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: dbHeaders() });
  if (!r.ok) throw new Error(`db_get_${r.status}`);
  return r.json();
}
async function patchJob(id, patch) {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/product_intake_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`job_patch_${r.status}`);
  return (await r.json())[0] || null;
}
async function patchProduct(id, patch) {
  if (!id) return null;
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`product_patch_${r.status}`);
  return (await r.json())[0] || null;
}
async function getProduct(job) {
  if (job.store_product_id) {
    const byId = await dbGet(`products?id=eq.${encodeURIComponent(job.store_product_id)}&select=*&limit=1`);
    if (byId[0]) return byId[0];
  }
  const rows = await dbGet(`products?supplier_product_id=eq.${encodeURIComponent(job.supplier_product_id)}&select=*&limit=1`);
  return rows[0] || null;
}
function sourceImage(product) {
  const raw = clean(product?.image_url, 2000);
  if (raw && raw.length <= 200) return raw;
  return KNOWN_SHORT_SOURCE_IMAGES[String(product?.supplier_product_id || '')] || '';
}
function sourceRecord(json, sourcingId) {
  const data = json?.data;
  const list = Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : null);
  if (list) return list.find((x) => String(x?.sourceId || x?.cjSourcingId || '') === String(sourcingId)) || list[0] || null;
  return data && typeof data === 'object' ? data : null;
}
async function variantFromSku(sku) {
  const json = await cjCall(`/product/variant/query?variantSku=${encodeURIComponent(sku)}`);
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.find((v) => String(v?.variantSku || '') === String(sku)) || rows[0] || null;
}
async function variantWithInventory(vid) {
  const json = await cjCall(`/product/variant/queryByVid?vid=${encodeURIComponent(vid)}&features=enable_inventory`);
  return json.data && typeof json.data === 'object' ? json.data : null;
}
async function freightToIsrael(vid, origin = 'CN') {
  const json = await cjCall('/logistic/freightCalculate', {
    method: 'POST',
    body: { startCountryCode: origin, endCountryCode: 'IL', products: [{ quantity: 1, vid }] }
  });
  return Array.isArray(json.data) ? json.data : [];
}
function cheapestFreight(options) {
  const valid = (options || []).filter((x) => Number.isFinite(Number(x?.logisticPrice)) && Number(x.logisticPrice) >= 0);
  valid.sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice));
  return valid[0] || null;
}
async function quotaInfo() {
  try {
    const json = await cjCall('/setting/get');
    const limits = Array.isArray(json?.data?.setting?.quotaLimits) ? json.data.setting.quotaLimits : [];
    return {
      root: clean(json?.data?.root, 30) || null,
      sandboxAccount: Boolean(json?.data?.isSandbox),
      qpsLimit: json?.data?.setting?.qpsLimit ?? null,
      sourcingLimits: limits.filter((x) => String(x?.quotaUrl || '').includes('/product/sourcing'))
    };
  } catch (e) {
    return { error: clean(e.message, 240) };
  }
}
async function syncSourcing(job) {
  const result = await querySourcing([String(job.provider_sourcing_id)]);
  const source = sourceRecord(result, job.provider_sourcing_id) || {};
  const sourceStatus = clean(source.sourceStatus, 40);
  const sourceStatusStr = clean(source.sourceStatusStr, 120);
  const cjProductId = clean(source.cjProductId, 100);
  const cjVariantSku = clean(source.cjVariantSku, 160);

  if (sourceStatus === '5') {
    return patchJob(job.id, {
      status: 'failed', provider_status: 'sourcing_failed', provider_product_id: null, provider_variant_id: null,
      provider_variant_sku: null, provider_snapshot: source,
      last_error: `cj_sourcing_failed${sourceStatusStr ? `_${sourceStatusStr}` : ''}`, processed_at: new Date().toISOString()
    });
  }

  if (!cjProductId || !cjVariantSku) {
    return patchJob(job.id, {
      status: 'awaiting_supplier_quote', provider_status: `sourcing_${sourceStatus || 'pending'}`,
      provider_product_id: null, provider_variant_id: null, provider_variant_sku: null,
      provider_snapshot: source, last_error: null, processed_at: new Date().toISOString()
    });
  }

  const variant = await variantFromSku(cjVariantSku);
  if (!variant?.vid) {
    return patchJob(job.id, {
      status: 'needs_supplier_mapping', provider_status: 'cj_variant_lookup_pending', provider_product_id: cjProductId,
      provider_variant_sku: cjVariantSku, provider_variant_id: null, provider_snapshot: { source }, last_error: null,
      processed_at: new Date().toISOString()
    });
  }
  await sleep(1050);
  const detailed = await variantWithInventory(String(variant.vid));
  const inventories = Array.isArray(detailed?.inventories) ? detailed.inventories : [];
  const origins = inventories.map((x) => clean(x?.countryCode, 2)).filter(Boolean);
  const origin = origins.includes('CN') ? 'CN' : (origins[0] || 'CN');
  await sleep(1050);
  let freight = [];
  let freightError = null;
  try { freight = await freightToIsrael(String(variant.vid), origin); } catch (e) { freightError = clean(e.message, 300); }
  const chosen = cheapestFreight(freight);
  const totalInventory = inventories.reduce((sum, x) => sum + (Number(x?.totalInventory) || 0), 0);
  const providerSnapshot = {
    source,
    variant: detailed || variant,
    freight,
    selectedFreight: chosen,
    origin,
    totalInventory,
    freightError,
    checkedAt: new Date().toISOString()
  };
  const quoted = Boolean(chosen && Number.isFinite(Number(detailed?.variantSellPrice ?? variant?.variantSellPrice)));
  const status = quoted ? 'needs_profit_rule' : 'awaiting_supplier_quote';
  const providerStatus = quoted ? 'cj_quote_ready' : 'cj_mapping_ready_quote_pending';
  const updated = await patchJob(job.id, {
    status, provider_status: providerStatus, provider_product_id: cjProductId, provider_variant_id: String(variant.vid),
    provider_variant_sku: cjVariantSku, provider_snapshot: providerSnapshot, last_error: freightError,
    processed_at: new Date().toISOString()
  });
  if (job.store_product_id) {
    await patchProduct(job.store_product_id, {
      fulfillment_provider: 'cj', fulfillment_product_id: cjProductId, fulfillment_variant_id: String(variant.vid),
      fulfillment_sku: cjVariantSku, fulfillment_origin_country: origin,
      fulfillment_logistic_name: chosen?.logisticName || null,
      fulfillment_provider_status: quoted ? 'quoted' : 'mapped',
      fulfillment_provider_snapshot: providerSnapshot,
      fulfillment_verified_at: quoted ? new Date().toISOString() : null
    });
  }
  return updated;
}
async function retryDailyLimited(job) {
  if (job.provider_sourcing_id || String(job.last_error || '') !== DAILY_LIMIT_ERROR || utcDay(job.updated_at) >= utcDay()) return { job, attempted: false };
  const product = await getProduct(job);
  if (!product) throw new Error('catalog_product_missing');
  const image = sourceImage(product);
  if (!clean(product.name, 200) || !image) throw new Error('catalog_product_data_missing');
  const selectedSku = clean(job.requested_sku_id || product.supplier_sku_id, 100);
  const selectedVariant = clean(job.requested_variant_label || product.variant_label, 200);
  try {
    const result = await createSourcing({
      thirdProductId: String(job.supplier_product_id), thirdVariantId: selectedSku, thirdProductSku: selectedSku,
      productName: clean(product.name, 200), productImage: image,
      productUrl: `https://www.aliexpress.com/item/${job.supplier_product_id}.html`,
      remark: clean([selectedVariant ? `Variant: ${selectedVariant}` : '', selectedSku ? `AliExpress SKU: ${selectedSku}` : ''].filter(Boolean).join(' | '), 200)
    });
    const sourcingId = clean(result?.data?.cjSourcingId || result?.data?.sourceId, 100);
    if (!sourcingId) throw new Error('cj_sourcing_id_missing');
    const updated = await patchJob(job.id, {
      status: 'awaiting_supplier_quote', provider_status: 'sourcing_requested', provider_sourcing_id: sourcingId,
      provider_product_id: null, provider_variant_id: null, provider_variant_sku: null,
      provider_snapshot: result?.data || {}, last_error: null, attempts: Number(job.attempts || 0) + 1,
      processed_at: new Date().toISOString()
    });
    return { job: updated, attempted: true };
  } catch (e) {
    const updated = await patchJob(job.id, {
      status: 'failed', provider_status: 'cj_error', last_error: clean(e.message, 500), attempts: Number(job.attempts || 0) + 1,
      processed_at: new Date().toISOString()
    });
    return { job: updated, attempted: true };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const mode = String(req.query?.mode || 'sync');
    const quota = await quotaInfo();
    const jobs = await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100');
    const results = [];
    for (const job of jobs.filter((x) => x.provider_sourcing_id)) {
      try {
        const updated = await syncSourcing(job);
        results.push({ supplier_product_id: job.supplier_product_id, kind: 'sync', status: updated?.status, provider_status: updated?.provider_status, cj_product_id: updated?.provider_product_id || null, cj_variant_id: updated?.provider_variant_id || null, cj_variant_sku: updated?.provider_variant_sku || null });
      } catch (e) {
        results.push({ supplier_product_id: job.supplier_product_id, kind: 'sync', error: clean(e.message, 260) });
      }
      await sleep(1100);
    }
    if (mode === 'retry') {
      const fresh = await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100');
      for (const job of fresh.filter((x) => !x.provider_sourcing_id && String(x.last_error || '') === DAILY_LIMIT_ERROR)) {
        try {
          const out = await retryDailyLimited(job);
          results.push({ supplier_product_id: job.supplier_product_id, kind: 'retry', attempted: out.attempted, status: out.job?.status, provider_status: out.job?.provider_status, sourcing_id: out.job?.provider_sourcing_id || null, error: out.job?.last_error || null });
        } catch (e) {
          results.push({ supplier_product_id: job.supplier_product_id, kind: 'retry', error: clean(e.message, 260) });
        }
        await sleep(1100);
      }
    }
    const rows = await dbGet('product_intake_jobs?select=status,provider_status,provider_sourcing_id,provider_product_id,provider_variant_id,last_error');
    const summary = {
      total: rows.length,
      sourcing: rows.filter((r) => r.provider_sourcing_id).length,
      pending: rows.filter((r) => String(r.provider_status || '').startsWith('sourcing_')).length,
      quoteReady: rows.filter((r) => r.provider_status === 'cj_quote_ready').length,
      dailyLimited: rows.filter((r) => String(r.last_error || '') === DAILY_LIMIT_ERROR).length,
      failed: rows.filter((r) => r.status === 'failed').length
    };
    return res.status(200).json({ ok: true, mode, quota, summary, results });
  } catch (e) {
    console.error('CJ maintenance v2 failed:', e.message);
    return res.status(500).json({ ok: false, error: clean(e.message, 300) });
  }
};
