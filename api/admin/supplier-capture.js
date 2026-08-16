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
      host: String(v && v.host || '').slice(0, 180),
      path: String(v && v.path || '').slice(0, 320),
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseJsonMaybe(v) {
  if (!v || typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

function moneyFromText(value) {
  const text = String(value || '').replace(/,/g, '');
  const match = text.match(/₪\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : null;
}

function selectedSkuPairs(compact) {
  const pairs = [];
  for (const raw of compact.selectedAttributes || []) {
    const m = String(raw).match(/^data-sku-col=(\d+)-(\d+)$/i);
    if (m) pairs.push(`${m[1]}:${m[2]}`);
  }
  return [...new Set(pairs)];
}

function rowByModule(rows, moduleName) {
  const suffix = String(moduleName).toUpperCase();
  return rows.find((r) => {
    const path = String(r && r.path || '').toUpperCase();
    return path === `ROOT.DATA.RESULT.${suffix}` || path.endsWith(`.${suffix}`);
  }) || null;
}

function extractVerifiedPdp(compact) {
  if (!compact.globals.includes('pdp_response_v2')) return null;
  const rows = compact.cacheMatches.filter((r) => r && r.global === 'pdp_response' && r.snapshot && typeof r.snapshot === 'object');
  if (!rows.length) return null;

  const skuRow = rowByModule(rows, 'SKU');
  if (!skuRow) return null;
  const skuModule = skuRow.snapshot;
  const skuId = String(skuModule.selectedSkuIdStr || skuModule.selectedSkuId || '').trim();
  if (!/^\d{5,30}$/.test(skuId)) return null;

  const skuPaths = Array.isArray(skuModule.skuPaths) ? skuModule.skuPaths : [];
  const selectedPath = skuPaths.find((x) => String(x && (x.skuIdStr || x.skuId) || '') === skuId);
  if (!selectedPath) return null;

  const chosenPairs = selectedSkuPairs(compact);
  const pathPairs = String(selectedPath.path || '').split(';').map((x) => x.trim()).filter(Boolean);
  if (chosenPairs.length && !chosenPairs.every((pair) => pathPairs.includes(pair))) return null;

  const selectedAttr = String(skuModule.selectedSkuAttr || selectedPath.skuAttr || '');
  const variantVerified = chosenPairs.length > 0 && chosenPairs.every((pair) => pathPairs.includes(pair));
  const salable = selectedPath.salable === true && skuModule.selectedSkuSaleable !== false;

  let stock = num(selectedPath.skuStock);
  if (!Number.isInteger(stock) || stock < 0) stock = null;

  const quantityRow = rowByModule(rows, 'QUANTITY_PC');
  let maxOrderQuantity = null;
  if (quantityRow) {
    const q = quantityRow.snapshot || {};
    if (stock === null) {
      const inv = num(q.totalAvailableInventory);
      if (Number.isInteger(inv) && inv >= 0) stock = inv;
    }
    const maxBuy = num(q.currentSkuQuantityView && q.currentSkuQuantityView.maxBuyCount);
    if (Number.isInteger(maxBuy) && maxBuy > 0) maxOrderQuantity = maxBuy;
  }

  const priceRow = rowByModule(rows, 'PRICE');
  let price = null;
  let priceCurrency = null;
  let originalPrice = null;
  if (priceRow) {
    const p = priceRow.snapshot || {};
    const pProductId = String(p.productId || '');
    const pSkuId = String(p.selectedSkuId || '');
    if ((!pProductId || pProductId === compact.productId) && (!pSkuId || pSkuId === skuId)) {
      const info = p.targetSkuPriceInfo || (p.skuIdStrPriceInfoMap && p.skuIdStrPriceInfoMap[skuId]) || (p.skuPriceInfoMap && p.skuPriceInfoMap[skuId]) || null;
      if (info) {
        price = moneyFromText(info.salePriceString) ?? moneyFromText(info.salePriceLocal);
        const original = info.originalPrice || {};
        const ov = num(original.value);
        if (ov !== null && ov >= 0) originalPrice = Number(ov.toFixed(2));
        priceCurrency = String(original.currency || p.currencyCode || '').toUpperCase() || (price !== null ? 'ILS' : null);
      }
    }
  }

  const shippingRow = rowByModule(rows, 'SHIPPING');
  let shipping = null;
  let shippingCurrency = null;
  let shippingAvailable = null;
  let shipFromCountry = null;
  let deliveryDayMin = null;
  let deliveryDayMax = null;
  if (shippingRow) {
    const shippingModule = shippingRow.snapshot || {};
    const layouts = Array.isArray(shippingModule.deliveryLayoutInfo) ? shippingModule.deliveryLayoutInfo : [];
    const candidates = layouts.map((x) => x && x.bizData).filter(Boolean);
    const biz = candidates.find((x) => {
      const itemId = String(x.itemId || x.productId || '');
      const country = String(x.shipToCode || x.shipToCountry || '').toUpperCase();
      return (!itemId || itemId === compact.productId) && (!country || country === 'IL');
    }) || null;
    if (biz) {
      const ut = parseJsonMaybe(biz.utParams) || {};
      const itemId = String(ut.itemId || ut.productId || biz.itemId || '');
      const country = String(ut.shipToCountry || biz.shipToCode || '').toUpperCase();
      if ((!itemId || itemId === compact.productId) && (!country || country === 'IL')) {
        const displayCurrency = String(biz.displayCurrency || ut.fCurrency || ut.currency || '').toUpperCase();
        const directAmount = num(biz.displayAmount);
        const utAmount = num(ut.fAmount);
        if (String(biz.shippingFee || '').toLowerCase() === 'free') shipping = 0;
        else if (displayCurrency === 'ILS' && directAmount !== null && directAmount >= 0) shipping = Number(directAmount.toFixed(2));
        else if (String(ut.fCurrency || '').toUpperCase() === 'ILS' && utAmount !== null && utAmount >= 0) shipping = Number(utAmount.toFixed(2));
        if (shipping !== null) {
          shippingCurrency = 'ILS';
          shippingAvailable = true;
        }
        shipFromCountry = String(ut.shipFrom || biz.shipFromCode || '').toUpperCase() || null;
        deliveryDayMin = num(ut.deliveryDayMin ?? biz.deliveryDayMin);
        deliveryDayMax = num(ut.deliveryDayMax ?? biz.deliveryDayMax);
      }
    }
  }

  const inStock = salable && (stock === null || stock > 0);
  if (!variantVerified || price === null || priceCurrency !== 'ILS' || shipping === null || stock === null) return null;

  return {
    skuId,
    selectedAttr,
    variantVerified,
    salable,
    stock,
    inStock,
    price,
    priceCurrency,
    originalPrice,
    shipping,
    shippingCurrency,
    shippingAvailable,
    shipFromCountry,
    maxOrderQuantity,
    deliveryDayMin,
    deliveryDayMax
  };
}

async function applyVerifiedPdp(compact, supabaseUrl) {
  const verified = extractVerifiedPdp(compact);
  if (!verified) return null;

  const read = await fetch(`${supabaseUrl}/rest/v1/products?supplier_product_id=eq.${encodeURIComponent(compact.productId)}&select=id,supplier_product_id,variant_label&limit=1`, { headers: dbHeaders() });
  if (!read.ok) throw new Error(`verified_product_read_${read.status}`);
  const product = (await read.json())[0];
  if (!product) return null;

  const update = {
    supplier_sku_id: verified.skuId,
    sku_verified_at: compact.capturedAt,
    sku_verified_by: 'aliexpress_pdp_v2',
    supplier_stock: verified.stock,
    supplier_in_stock: verified.inStock,
    supplier_price: verified.price,
    supplier_currency: verified.priceCurrency,
    supplier_price_ils: verified.price,
    supplier_shipping: verified.shipping,
    shipping_currency: verified.shippingCurrency,
    supplier_shipping_available: verified.shippingAvailable,
    supplier_ship_from_country: verified.shipFromCountry,
    shipping_last_checked_at: compact.capturedAt,
    max_order_quantity: verified.maxOrderQuantity,
    supplier_sync_error: null,
    shipping_sync_error: null,
    last_sync_at: compact.capturedAt,
    fulfillment_ready: false,
    updated_at: new Date().toISOString()
  };

  const save = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(update)
  });
  if (!save.ok) throw new Error(`verified_product_save_${save.status}_${(await save.text()).slice(0, 160)}`);
  const saved = (await save.json())[0] || null;

  await audit('supplier_pdp_verified_capture', 'product', product.id, {
    supplier_product_id: compact.productId,
    supplier_sku_id: verified.skuId,
    variant: compact.variant,
    selected_attr: verified.selectedAttr,
    supplier_price_ils: verified.price,
    supplier_shipping_ils: verified.shipping,
    supplier_stock: verified.stock,
    max_order_quantity: verified.maxOrderQuantity,
    ship_from: verified.shipFromCountry,
    delivery_day_min: verified.deliveryDayMin,
    delivery_day_max: verified.deliveryDayMax
  });
  return saved;
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
    const { supabaseUrl } = config();

    if (body.action === 'diagnostic') {
      const { compact, encoded } = safeDiagnostic(body);
      console.log('ALI_DEEP_DIAGNOSTIC', encoded);
      const saveDiagnostic = await fetch(`${supabaseUrl}/rest/v1/supplier_capture_debug`, {
        method: 'POST',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({
          product_id: null,
          supplier_product_id: compact.productId,
          page_url: compact.pageUrl || null,
          captured_at: compact.capturedAt,
          payload: compact
        })
      });
      if (!saveDiagnostic.ok) throw new Error(`diagnostic_save_${saveDiagnostic.status}_${(await saveDiagnostic.text()).slice(0, 200)}`);
      const savedDiag = (await saveDiagnostic.json())[0] || null;
      const applied = await applyVerifiedPdp(compact, supabaseUrl);
      await audit('supplier_deep_diagnostic', 'product', compact.productId, {
        variant: compact.variant,
        cache_match_count: compact.cacheMatches.length,
        network_body_count: compact.networkBodies.length,
        snapshot_id: savedDiag && savedDiag.id || null,
        auto_applied: Boolean(applied)
      });
      return res.status(200).json({ ok: true, received: true, snapshot_id: savedDiag && savedDiag.id || null, auto_applied: Boolean(applied), product: applied });
    }

    const id = cleanId(body.id, /^[A-Za-z0-9_-]{1,80}$/, 'invalid_product_id');
    const productId = cleanId(body.supplier_product_id, /^\d{8,20}$/, 'invalid_supplier_product_id');
    const skuId = cleanId(body.supplier_sku_id, /^\d{5,30}$/, 'invalid_supplier_sku_id');
    const capturedAt = cleanDate(body.captured_at);
    const stock = cleanStock(body.supplier_stock);
    const inStock = body.supplier_in_stock === true ? true : body.supplier_in_stock === false ? false : stock === null ? null : stock > 0;

    const read = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,supplier_product_id,supplier_sku_id,variant_label&limit=1`, { headers: dbHeaders() });
    if (!read.ok) throw new Error(`product_read_${read.status}`);
    const product = (await read.json())[0];
    if (!product) return res.status(404).json({ ok: false, error: 'product_not_found' });
    if (String(product.supplier_product_id || '') !== productId) return res.status(409).json({ ok: false, error: 'supplier_product_mismatch' });

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
    if (!save.ok) throw new Error(`supplier_capture_save_${save.status}_${(await save.text()).slice(0, 200)}`);
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
    const known = ['invalid_product_id', 'invalid_supplier_product_id', 'invalid_supplier_sku_id', 'invalid_supplier_stock', 'invalid_date'];
    for (const code of known) if (message.includes(code)) return res.status(400).json({ ok: false, error: code });
    return res.status(500).json({ ok: false, error: 'supplier_capture_failed' });
  }
};