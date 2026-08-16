const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');

function cleanId(value, pattern, code) {
  const text = String(value || '').trim();
  if (!pattern.test(text)) throw new Error(code);
  return text;
}

function cleanStock(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new Error('invalid_supplier_stock');
  return n;
}

function cleanDate(value) {
  const d = new Date(value || Date.now());
  if (!Number.isFinite(d.getTime())) throw new Error('invalid_date');
  return d.toISOString();
}

function safeDiagnostic(body) {
  const productId = cleanId(body.supplier_product_id, /^\d{8,20}$/, 'invalid_supplier_product_id');
  const raw = body.diagnostic && typeof body.diagnostic === 'object' ? body.diagnostic : {};
  const compact = {
    productId,
    capturedAt: cleanDate(body.captured_at),
    variant: String(raw.variant || '').slice(0, 300),
    selectedHtml: String(raw.selectedHtml || '').slice(0, 7000),
    selectedAttributes: Array.isArray(raw.selectedAttributes) ? raw.selectedAttributes.slice(0, 30).map((v) => String(v).slice(0, 300)) : [],
    globals: Array.isArray(raw.globals) ? raw.globals.slice(0, 40).map((v) => String(v).slice(0, 200)) : [],
    cacheMatches: Array.isArray(raw.cacheMatches) ? raw.cacheMatches.slice(0, 30) : [],
    resourcePaths: Array.isArray(raw.resourcePaths) ? raw.resourcePaths.slice(0, 80) : [],
    counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {}
  };
  let encoded = JSON.stringify(compact);
  if (encoded.length > 90000) encoded = encoded.slice(0, 90000);
  return { compact, encoded };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (body.action === 'diagnostic') {
      const { compact, encoded } = safeDiagnostic(body);
      console.log('ALI_DEEP_DIAGNOSTIC', encoded);
      await audit('supplier_deep_diagnostic', 'product', compact.productId, {
        variant: compact.variant,
        cache_match_count: compact.cacheMatches.length,
        resource_path_count: compact.resourcePaths.length,
        global_count: compact.globals.length
      });
      return res.status(200).json({ ok: true, received: true });
    }

    const id = cleanId(body.id, /^[A-Za-z0-9_-]{1,80}$/, 'invalid_product_id');
    const productId = cleanId(body.supplier_product_id, /^\d{8,20}$/, 'invalid_supplier_product_id');
    const skuId = cleanId(body.supplier_sku_id, /^\d{5,30}$/, 'invalid_supplier_sku_id');
    const capturedAt = cleanDate(body.captured_at);
    const stock = cleanStock(body.supplier_stock);
    const inStock = body.supplier_in_stock === true ? true : body.supplier_in_stock === false ? false : stock === null ? null : stock > 0;

    const { supabaseUrl } = config();
    const read = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,supplier_product_id,supplier_sku_id,variant_label&limit=1`, { headers: dbHeaders() });
    if (!read.ok) throw new Error(`product_read_${read.status}`);
    const product = (await read.json())[0];
    if (!product) return res.status(404).json({ ok: false, error: 'product_not_found' });
    if (String(product.supplier_product_id || '') !== productId) {
      return res.status(409).json({ ok: false, error: 'supplier_product_mismatch' });
    }

    const update = {
      supplier_sku_id: skuId,
      supplier_in_stock: inStock,
      supplier_stock: stock,
      sku_verified_at: capturedAt,
      fulfillment_ready: false,
      updated_at: new Date().toISOString()
    };

    const save = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(update)
    });
    if (!save.ok) {
      const details = await save.text();
      throw new Error(`supplier_capture_save_${save.status}_${details.slice(0, 200)}`);
    }
    const saved = (await save.json())[0] || null;
    await audit('supplier_public_sku_capture', 'product', id, {
      supplier_product_id: productId,
      supplier_sku_id: skuId,
      supplier_stock: stock,
      supplier_in_stock: inStock,
      source: 'aliexpress_public_page'
    });
    return res.status(200).json({ ok: true, product: saved });
  } catch (error) {
    console.error('supplier capture error', error);
    const message = String(error && error.message || error);
    const known = ['invalid_product_id','invalid_supplier_product_id','invalid_supplier_sku_id','invalid_supplier_stock','invalid_date'];
    for (const code of known) if (message.includes(code)) return res.status(400).json({ ok: false, error: code });
    return res.status(500).json({ ok: false, error: 'supplier_capture_failed' });
  }
};
