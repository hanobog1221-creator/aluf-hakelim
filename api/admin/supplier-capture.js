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
    pageUrl: String(raw.pageUrl || '').slice(0, 2000),
    capturedAt: cleanDate(body.captured_at),
    variant: String(raw.variant || '').slice(0, 300),
    selectedHtml: String(raw.selectedHtml || '').slice(0, 7000),
    selectedAttributes: Array.isArray(raw.selectedAttributes) ? raw.selectedAttributes.slice(0, 30).map((v) => String(v).slice(0, 300)) : [],
    globals: Array.isArray(raw.globals) ? raw.globals.slice(0, 40).map((v) => String(v).slice(0, 200)) : [],
    cacheMatches: Array.isArray(raw.cacheMatches) ? raw.cacheMatches.slice(0, 36) : [],
    resourcePaths: Array.isArray(raw.resourcePaths) ? raw.resourcePaths.slice(0, 80) : [],
    networkBodies: Array.isArray(raw.networkBodies) ? raw.networkBodies.slice(0, 12).map((v) => ({
      host: String(v && v.host || '').slice(0, 180), path: String(v && v.path || '').slice(0, 320),
      status: Number.isFinite(Number(v && v.status)) ? Number(v.status) : null,
      queryKeys: Array.isArray(v && v.queryKeys) ? v.queryKeys.slice(0, 40).map((x) => String(x).slice(0, 100)) : [],
      snippets: Array.isArray(v && v.snippets) ? v.snippets.slice(0, 24).map((x) => String(x).slice(0, 1900)) : [],
      error: String(v && v.error || '').slice(0, 300)
    })) : [],
    counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {}
  };
  let encoded = JSON.stringify(compact);
  if (encoded.length > 120000) {
    compact.cacheMatches = compact.cacheMatches.slice(0, 18);
    compact.resourcePaths = compact.resourcePaths.slice(0, 40);
    compact.networkBodies = compact.networkBodies.slice(0, 6).map((x) => ({ ...x, snippets: x.snippets.slice(0, 10) }));
    encoded = JSON.stringify(compact);
  }
  return { compact, encoded: encoded.slice(0, 120000) };
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function parseJsonMaybe(v) {
  if (!v || typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}
function visit(value, fn, path = '', depth = 0, seen = new WeakSet()) {
  if (value == null || depth > 10) return;
  if (typeof value === 'string') {
    const parsed = parseJsonMaybe(value);
    if (parsed) visit(parsed, fn, path + '.__json', depth + 1, seen);
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) return;
  seen.add(value); fn(value, path);
  if (Array.isArray(value)) return value.slice(0, 150).forEach((v, i) => visit(v, fn, `${path}[${i}]`, depth + 1, seen));
  Object.keys(value).slice(0, 300).forEach((k) => visit(value[k], fn, path ? `${path}.${k}` : k, depth + 1, seen));
}
function extractVerifiedPdp(compact) {
  if (!compact.globals.includes('pdp_response_v2')) return null;
  const rows = compact.cacheMatches.filter((r) => r && r.global === 'pdp_response' && r.snapshot && typeof r.snapshot === 'object');
  if (!rows.length) return null;
  let skuId = null, stock = null, shipping = null, shippingAvailable = null;
  const qRow = rows.find((r) => /(^|\.)QUANTITY_PC$/i.test(String(r.path || '')) || /QUANTITY_PC/i.test(String(r.path || '')));
  if (qRow) {
    const q = qRow.snapshot;
    const all = q && q.allSkuQuantityView && typeof q.allSkuQuantityView === 'object' ? q.allSkuQuantityView : null;
    const ids = all ? Object.keys(all).filter((x) => /^\d{5,30}$/.test(x)) : [];
    if (ids.length === 1) skuId = ids[0];
    const inv = num(q && q.totalAvailableInventory);
    if (Number.isInteger(inv) && inv >= 0) stock = inv;
  }
  const shippingCandidates = [];
  for (const r of rows.filter((x) => /SHIPPING|DELIVERY/i.test(String(x.path || '')))) {
    visit(r.snapshot, (o, path) => {
      const itemId = String(o.itemId ?? o.productId ?? '');
      const country = String(o.shipToCountry ?? o.shipToCode ?? '').toUpperCase();
      const fee = num(o.shippingFee ?? o.fAmount ?? o.displayAmount);
      const formatted = String(o.formattedAmount || '');
      let ils = null;
      const m = formatted.match(/₪\s*([0-9]+(?:[.,][0-9]+)?)/); if (m) ils = Number(m[1].replace(',', '.'));
      if (itemId && itemId !== compact.productId) return;
      if (country && country !== 'IL') return;
      if (Number.isFinite(ils) && ils >= 0) shippingCandidates.push({ value: ils, score: 5, path });
      else if (Number.isFinite(fee) && fee >= 0 && String(o.fCurrency || o.currency || '').toUpperCase() === 'ILS') shippingCandidates.push({ value: fee, score: 4, path });
    });
  }
  if (shippingCandidates.length) {
    shippingCandidates.sort((a, b) => b.score - a.score);
    shipping = Number(shippingCandidates[0].value.toFixed(2)); shippingAvailable = true;
  }
  if (!skuId && stock === null && shipping === null) return null;
  return { skuId, stock, inStock: stock === null ? null : stock > 0, shipping, shippingAvailable };
}
async function applyVerifiedPdp(compact, supabaseUrl) {
  const verified = extractVerifiedPdp(compact);
  if (!verified) return null;
  const read = await fetch(`${supabaseUrl}/rest/v1/products?supplier_product_id=eq.${encodeURIComponent(compact.productId)}&select=id,supplier_product_id&limit=1`, { headers: dbHeaders() });
  if (!read.ok) throw new Error(`verified_product_read_${read.status}`);
  const product = (await read.json())[0]; if (!product) return null;
  const update = { fulfillment_ready: false, last_sync_at: compact.capturedAt, updated_at: new Date().toISOString() };
  if (verified.skuId) { update.supplier_sku_id = verified.skuId; update.sku_verified_at = compact.capturedAt; }
  if (verified.stock !== null) { update.supplier_stock = verified.stock; update.supplier_in_stock = verified.inStock; }
  if (verified.shipping !== null) { update.supplier_shipping = verified.shipping; update.supplier_shipping_available = verified.shippingAvailable; }
  const save = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
    method: 'PATCH', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(update)
  });
  if (!save.ok) throw new Error(`verified_product_save_${save.status}_${(await save.text()).slice(0, 160)}`);
  const saved = (await save.json())[0] || null;
  await audit('supplier_pdp_verified_capture', 'product', product.id, { ...verified, supplier_product_id: compact.productId, variant: compact.variant });
  return saved;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { supabaseUrl } = config();
    if (body.action === 'diagnostic') {
      const { compact, encoded } = safeDiagnostic(body); console.log('ALI_DEEP_DIAGNOSTIC', encoded);
      const saveDiagnostic = await fetch(`${supabaseUrl}/rest/v1/supplier_capture_debug`, {
        method: 'POST', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ product_id: null, supplier_product_id: compact.productId, page_url: compact.pageUrl || null, captured_at: compact.capturedAt, payload: compact })
      });
      if (!saveDiagnostic.ok) throw new Error(`diagnostic_save_${saveDiagnostic.status}_${(await saveDiagnostic.text()).slice(0, 200)}`);
      const savedDiag = (await saveDiagnostic.json())[0] || null;
      const applied = await applyVerifiedPdp(compact, supabaseUrl);
      await audit('supplier_deep_diagnostic', 'product', compact.productId, { variant: compact.variant, cache_match_count: compact.cacheMatches.length, network_body_count: compact.networkBodies.length, snapshot_id: savedDiag && savedDiag.id || null, auto_applied: Boolean(applied) });
      return res.status(200).json({ ok: true, received: true, snapshot_id: savedDiag && savedDiag.id || null, auto_applied: Boolean(applied), product: applied });
    }
    const id = cleanId(body.id, /^[A-Za-z0-9_-]{1,80}$/, 'invalid_product_id');
    const productId = cleanId(body.supplier_product_id, /^\d{8,20}$/, 'invalid_supplier_product_id');
    const skuId = cleanId(body.supplier_sku_id, /^\d{5,30}$/, 'invalid_supplier_sku_id');
    const capturedAt = cleanDate(body.captured_at); const stock = cleanStock(body.supplier_stock);
    const inStock = body.supplier_in_stock === true ? true : body.supplier_in_stock === false ? false : stock === null ? null : stock > 0;
    const read = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,supplier_product_id,supplier_sku_id,variant_label&limit=1`, { headers: dbHeaders() });
    if (!read.ok) throw new Error(`product_read_${read.status}`); const product = (await read.json())[0];
    if (!product) return res.status(404).json({ ok: false, error: 'product_not_found' });
    if (String(product.supplier_product_id || '') !== productId) return res.status(409).json({ ok: false, error: 'supplier_product_mismatch' });
    const update = { supplier_sku_id: skuId, supplier_in_stock: inStock, supplier_stock: stock, sku_verified_at: capturedAt, fulfillment_ready: false, updated_at: new Date().toISOString() };
    const save = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(update) });
    if (!save.ok) throw new Error(`supplier_capture_save_${save.status}_${(await save.text()).slice(0, 200)}`);
    const saved = (await save.json())[0] || null; await audit('supplier_public_sku_capture', 'product', id, { supplier_product_id: productId, supplier_sku_id: skuId, supplier_stock: stock, supplier_in_stock: inStock, source: 'aliexpress_public_page' });
    return res.status(200).json({ ok: true, product: saved });
  } catch (error) {
    console.error('supplier capture error', error); const message = String(error && error.message || error);
    const known = ['invalid_product_id','invalid_supplier_product_id','invalid_supplier_sku_id','invalid_supplier_stock','invalid_date'];
    for (const code of known) if (message.includes(code)) return res.status(400).json({ ok: false, error: code });
    return res.status(500).json({ ok: false, error: 'supplier_capture_failed' });
  }
};