const { config, dbHeaders } = require('./_lib/admin');
const { createSourcing, querySourcing } = require('./_lib/cj');

const DAILY_LIMIT_ERROR = 'cj_api_1600000_Exceeded the daily source limit';
const KNOWN_SHORT_SOURCE_IMAGES = {
  '1005012879937902': 'https://i.ebayimg.com/images/g/~5AAAOSwX05h7pN9/s-l1600.jpg'
};

function text(value, max = 200) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  return v.slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function utcDay(value = Date.now()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

async function dbGet(path) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: dbHeaders() });
  if (!response.ok) throw new Error(`db_get_${response.status}`);
  return response.json();
}

async function patchJob(id, patch) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/product_intake_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`job_patch_${response.status}`);
  return (await response.json())[0] || null;
}

async function patchProduct(id, patch) {
  if (!id) return null;
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`product_patch_${response.status}`);
  return (await response.json())[0] || null;
}

async function getProduct(job) {
  if (job.store_product_id) {
    const rows = await dbGet(`products?id=eq.${encodeURIComponent(job.store_product_id)}&select=*&limit=1`);
    if (rows[0]) return rows[0];
  }
  const rows = await dbGet(`products?supplier_product_id=eq.${encodeURIComponent(job.supplier_product_id)}&select=*&limit=1`);
  return rows[0] || null;
}

function sourceImage(product) {
  const raw = text(product?.image_url, 2000);
  if (raw && raw.length <= 200) return raw;
  return KNOWN_SHORT_SOURCE_IMAGES[String(product?.supplier_product_id || '')] || '';
}

function sourceRecord(json, sourcingId) {
  const data = json?.data;
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : null);
  if (list) {
    return list.find((row) => String(row?.sourceId || row?.cjSourcingId || '') === String(sourcingId)) || list[0] || null;
  }
  if (data && typeof data === 'object') return data;
  return null;
}

function sourceFields(source) {
  const providerProductId = text(source?.cjProductId || source?.productId, 100) || null;
  const providerVariantId = text(source?.variantId, 100) || null;
  const providerVariantSku = text(source?.cjVariantSku || source?.variantSku, 160) || null;
  const sourceStatus = text(source?.sourceStatus, 40);
  const sourceStatusStr = text(source?.sourceStatusStr, 200);
  return { providerProductId, providerVariantId, providerVariantSku, sourceStatus, sourceStatusStr };
}

async function syncExisting(job) {
  const result = await querySourcing([String(job.provider_sourcing_id)]);
  const source = sourceRecord(result, job.provider_sourcing_id) || {};
  const fields = sourceFields(source);

  if (fields.sourceStatus === '5') {
    return patchJob(job.id, {
      status: 'failed',
      provider_status: 'sourcing_failed',
      provider_snapshot: source,
      last_error: `cj_sourcing_failed${fields.sourceStatusStr ? `_${fields.sourceStatusStr}` : ''}`,
      processed_at: new Date().toISOString()
    });
  }

  const mapped = Boolean(fields.providerProductId && fields.providerVariantId);
  const updated = await patchJob(job.id, {
    status: mapped ? 'needs_supplier_mapping' : 'awaiting_supplier_quote',
    provider_status: mapped ? 'mapped' : `sourcing_${fields.sourceStatus || 'pending'}`,
    provider_product_id: fields.providerProductId,
    provider_variant_id: fields.providerVariantId,
    provider_variant_sku: fields.providerVariantSku,
    provider_snapshot: source,
    last_error: null,
    processed_at: new Date().toISOString()
  });

  if (mapped && job.store_product_id) {
    await patchProduct(job.store_product_id, {
      fulfillment_provider: 'cj',
      fulfillment_product_id: fields.providerProductId,
      fulfillment_variant_id: fields.providerVariantId,
      fulfillment_sku: fields.providerVariantSku,
      fulfillment_provider_status: 'mapped',
      fulfillment_provider_snapshot: source,
      fulfillment_verified_at: new Date().toISOString()
    });
  }
  return updated;
}

async function retryDailyLimited(job) {
  if (job.provider_sourcing_id) return job;
  if (String(job.last_error || '') !== DAILY_LIMIT_ERROR) return job;
  if (utcDay(job.updated_at) >= utcDay()) return job;

  const product = await getProduct(job);
  if (!product) throw new Error('catalog_product_missing');
  const image = sourceImage(product);
  if (!text(product.name, 200) || !image) throw new Error('catalog_product_data_missing');

  const selectedSku = text(job.requested_sku_id || product.supplier_sku_id, 100);
  const selectedVariant = text(job.requested_variant_label || product.variant_label, 200);
  const remark = text([
    selectedVariant ? `Variant: ${selectedVariant}` : '',
    selectedSku ? `AliExpress SKU: ${selectedSku}` : ''
  ].filter(Boolean).join(' | '), 200);

  try {
    const result = await createSourcing({
      thirdProductId: String(job.supplier_product_id),
      thirdVariantId: selectedSku,
      thirdProductSku: selectedSku,
      productName: text(product.name, 200),
      productImage: image,
      productUrl: `https://www.aliexpress.com/item/${job.supplier_product_id}.html`,
      remark
    });
    const data = result?.data || {};
    const sourcingId = text(data.cjSourcingId || data.sourceId, 100);
    if (!sourcingId) throw new Error('cj_sourcing_id_missing');
    return patchJob(job.id, {
      status: 'awaiting_supplier_quote',
      provider_status: 'sourcing_requested',
      provider_sourcing_id: sourcingId,
      provider_snapshot: data,
      last_error: null,
      attempts: Number(job.attempts || 0) + 1,
      processed_at: new Date().toISOString()
    });
  } catch (error) {
    return patchJob(job.id, {
      status: 'failed',
      provider_status: 'cj_error',
      last_error: text(error?.message || error, 500),
      attempts: Number(job.attempts || 0) + 1,
      processed_at: new Date().toISOString()
    });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const mode = String(req.query?.mode || 'sync');
    const jobs = await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100');
    const results = [];

    for (const job of jobs.filter((row) => row.provider_sourcing_id)) {
      try {
        const updated = await syncExisting(job);
        results.push({ id: job.id, kind: 'sync', status: updated?.status, provider_status: updated?.provider_status, mapped: Boolean(updated?.provider_product_id && updated?.provider_variant_id) });
      } catch (error) {
        results.push({ id: job.id, kind: 'sync', error: text(error?.message || error, 240) });
      }
      await sleep(1100);
    }

    if (mode === 'retry') {
      const fresh = await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100');
      for (const job of fresh.filter((row) => !row.provider_sourcing_id && String(row.last_error || '') === DAILY_LIMIT_ERROR)) {
        try {
          const before = String(job.updated_at || '');
          const updated = await retryDailyLimited(job);
          results.push({ id: job.id, kind: 'retry', attempted: String(updated?.updated_at || '') !== before, status: updated?.status, provider_status: updated?.provider_status, sourcing_id: updated?.provider_sourcing_id || null, error: updated?.last_error || null });
        } catch (error) {
          results.push({ id: job.id, kind: 'retry', error: text(error?.message || error, 240) });
        }
        await sleep(1100);
      }
    }

    const finalRows = await dbGet('product_intake_jobs?select=status,provider_status,provider_sourcing_id,provider_product_id,provider_variant_id,last_error');
    const summary = {
      total: finalRows.length,
      sourcing: finalRows.filter((r) => r.provider_sourcing_id).length,
      mapped: finalRows.filter((r) => r.provider_product_id && r.provider_variant_id).length,
      daily_limited: finalRows.filter((r) => String(r.last_error || '') === DAILY_LIMIT_ERROR).length,
      failed: finalRows.filter((r) => r.status === 'failed').length
    };
    return res.status(200).json({ ok: true, mode, summary, results });
  } catch (error) {
    console.error('CJ maintenance failed:', error.message);
    return res.status(500).json({ ok: false, error: text(error?.message || error, 300) });
  }
};
