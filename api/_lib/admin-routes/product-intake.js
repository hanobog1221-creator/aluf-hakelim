const crypto = require('crypto');
const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { createSourcing, querySourcing } = require('../_lib/cj');

const KNOWN_SHORT_SOURCE_IMAGES = {
  '1005012879937902': 'https://i.ebayimg.com/images/g/~5AAAOSwX05h7pN9/s-l1600.jpg'
};

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function text(value, max = 200) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  return v.slice(0, max);
}

function productIdFromUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\/item\/(\d{8,20})(?:\.html)?/i) || raw.match(/\b(100\d{10,17})\b/);
  return match ? match[1] : null;
}

function canonicalAliExpressUrl(productId) {
  return `https://www.aliexpress.com/item/${productId}.html`;
}

function sourceImage(product) {
  const raw = text(product?.image_url, 2000);
  if (raw && raw.length <= 200) return raw;
  return KNOWN_SHORT_SOURCE_IMAGES[String(product?.supplier_product_id || '')] || '';
}

function requestKey(productId, variant) {
  return crypto.createHash('sha256').update(`${productId}|${variant || ''}`).digest('hex');
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
    method: 'PATCH',
    headers: dbHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!r.ok) {
    const details = await r.text();
    throw new Error(`job_patch_${r.status}_${details.slice(0, 160)}`);
  }
  return (await r.json())[0] || null;
}

async function getJob(id) {
  const rows = await dbGet(`product_intake_jobs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows[0] || null;
}

async function getProduct(job) {
  if (job.store_product_id) {
    const byId = await dbGet(`products?id=eq.${encodeURIComponent(job.store_product_id)}&select=*&limit=1`);
    if (byId[0]) return byId[0];
  }
  const rows = await dbGet(`products?supplier_product_id=eq.${encodeURIComponent(job.supplier_product_id)}&select=*&limit=1`);
  return rows[0] || null;
}

function sourceRecord(json) {
  const data = json?.data;
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === 'object') return data;
  return null;
}

async function markFailure(job, error) {
  const message = text(error?.message || error || 'product_intake_failed', 500);
  const updated = await patchJob(job.id, {
    status: 'failed',
    provider_status: message.startsWith('cj_') ? 'cj_error' : (job.provider_status || 'failed'),
    last_error: message,
    processed_at: new Date().toISOString()
  });
  await audit('product_intake_failed', 'product_intake_job', job.id, { error: message });
  return updated;
}

async function processJob(originalJob) {
  let job = originalJob;
  const attempts = Number(job.attempts || 0) + 1;
  job = await patchJob(job.id, {
    status: 'processing',
    attempts,
    last_error: null,
    fulfillment_provider: 'cj'
  });

  try {
    const product = await getProduct(job);
    if (!product) throw new Error('catalog_product_missing');

    const image = sourceImage(product);
    if (!text(product.name, 200)) throw new Error('catalog_product_name_missing');
    if (!image) throw new Error('catalog_product_image_missing_or_too_long');

    const selectedSku = text(job.requested_sku_id || product.supplier_sku_id, 100);
    const selectedVariant = text(job.requested_variant_label || product.variant_label, 200);
    const snapshot = {
      title: text(product.name, 200),
      image,
      supplierProductId: String(job.supplier_product_id),
      supplierSkuId: selectedSku || null,
      variantLabel: selectedVariant || null,
      supplierUrl: canonicalAliExpressUrl(job.supplier_product_id),
      source: 'stored_catalog_fallback'
    };

    if (job.provider_sourcing_id) {
      const result = await querySourcing([String(job.provider_sourcing_id)]);
      const source = sourceRecord(result) || {};
      const providerProductId = text(source.cjProductId || source.productId, 100) || null;
      const providerVariantId = text(source.variantId, 100) || null;
      const providerVariantSku = text(source.cjVariantSku, 160) || null;
      const sourceStatus = text(source.sourceStatus, 40);
      const sourceStatusStr = text(source.sourceStatusStr, 200);

      if (sourceStatus === '5') {
        throw new Error(`cj_sourcing_failed${sourceStatusStr ? `_${sourceStatusStr}` : ''}`);
      }

      const mapped = Boolean(providerProductId && providerVariantId);
      const updated = await patchJob(job.id, {
        snapshot,
        status: 'awaiting_supplier_quote',
        provider_status: mapped ? 'mapped_waiting_quote' : `sourcing_${sourceStatus || 'pending'}`,
        provider_product_id: providerProductId,
        provider_variant_id: providerVariantId,
        provider_variant_sku: providerVariantSku,
        provider_snapshot: source,
        store_product_id: product.id,
        last_error: null,
        processed_at: new Date().toISOString()
      });
      await audit('product_intake_cj_query', 'product_intake_job', job.id, {
        sourcing_id: job.provider_sourcing_id,
        mapped,
        source_status: sourceStatus || null
      });
      return updated;
    }

    const remarkParts = [];
    if (selectedVariant) remarkParts.push(`Variant: ${selectedVariant}`);
    if (selectedSku) remarkParts.push(`AliExpress SKU: ${selectedSku}`);

    const result = await createSourcing({
      thirdProductId: String(job.supplier_product_id),
      thirdVariantId: selectedSku,
      thirdProductSku: selectedSku,
      productName: text(product.name, 200),
      productImage: image,
      productUrl: canonicalAliExpressUrl(job.supplier_product_id),
      remark: text(remarkParts.join(' | '), 200)
    });
    const data = result?.data || {};
    const sourcingId = text(data.cjSourcingId || data.sourceId, 100);
    if (!sourcingId) throw new Error('cj_sourcing_id_missing');

    const updated = await patchJob(job.id, {
      snapshot,
      status: 'awaiting_supplier_quote',
      provider_status: 'sourcing_requested',
      provider_sourcing_id: sourcingId,
      provider_snapshot: data,
      store_product_id: product.id,
      last_error: null,
      processed_at: new Date().toISOString()
    });
    await audit('product_intake_cj_sourcing_created', 'product_intake_job', job.id, {
      sourcing_id: sourcingId,
      supplier_product_id: job.supplier_product_id,
      store_product_id: product.id
    });
    return updated;
  } catch (error) {
    return markFailure(job, error);
  }
}

async function createOrReuseJob(body) {
  const supplierUrl = text(body.supplier_url, 2000);
  const productId = productIdFromUrl(supplierUrl);
  if (!productId) throw new Error('supplier_product_id_missing');
  const variant = text(body.variant_label, 200);
  const key = requestKey(productId, variant);

  const existing = await dbGet(`product_intake_jobs?request_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  if (existing[0]) return existing[0];

  const products = await dbGet(`products?supplier_product_id=eq.${encodeURIComponent(productId)}&select=id,supplier_sku_id,variant_label&limit=1`);
  const product = products[0] || {};
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/product_intake_jobs`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      request_key: key,
      supplier_url: supplierUrl,
      supplier_product_id: productId,
      requested_sku_id: product.supplier_sku_id || null,
      requested_variant_label: variant || product.variant_label || null,
      status: 'queued',
      fulfillment_provider: 'cj',
      provider_status: 'not_started',
      store_product_id: product.id || null
    })
  });
  if (!r.ok) throw new Error(`job_create_${r.status}`);
  return (await r.json())[0];
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const jobs = await dbGet('product_intake_jobs?select=*&order=updated_at.desc&limit=100');
      return res.status(200).json({ ok: true, jobs });
    }

    if (req.method === 'POST') {
      const job = await createOrReuseJob(bodyOf(req));
      const processed = await processJob(job);
      return res.status(200).json({ ok: true, job: processed });
    }

    if (req.method === 'PATCH') {
      const body = bodyOf(req);
      if (body.action !== 'retry' || !body.id) {
        return res.status(400).json({ ok: false, error: 'invalid_retry_request' });
      }
      const job = await getJob(String(body.id));
      if (!job) return res.status(404).json({ ok: false, error: 'job_not_found' });
      const processed = await processJob(job);
      return res.status(200).json({ ok: true, job: processed });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('product intake handler failed:', error.message);
    return res.status(500).json({ ok: false, error: error.message || 'product_intake_failed' });
  }
};
