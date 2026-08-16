const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken } = require('../_lib/aliexpress');
const { requireAdmin, config, dbHeaders } = require('../_lib/admin');

const PRODUCT_PATH = '/ds/product/get';

function isCron(req) {
  return String(req.headers['user-agent'] || '').includes('vercel-cron/1.0');
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function skuRows(result) {
  return toArray(
    result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ||
    result?.aeop_ae_product_s_k_us?.aeop_ae_product_sku ||
    result?.aeop_ae_product_skus?.aeop_ae_product_sku ||
    []
  );
}

function skuLabel(sku) {
  const props = toArray(
    sku?.ae_sku_property_dtos?.ae_sku_property_d_t_o ||
    sku?.aeop_s_k_u_property_list?.aeop_sku_property ||
    []
  );
  return props.map((p) =>
    p?.property_value_definition_name || p?.sku_property_value || p?.property_value_id || ''
  ).filter(Boolean).join(' / ');
}

function normalizedSku(sku) {
  const stockCountRaw = sku?.sku_available_stock ?? sku?.s_k_u_available_stock ?? sku?.ipm_sku_stock;
  const stockCount = stockCountRaw == null ? null : Number(stockCountRaw);
  const inStock = typeof sku?.sku_stock === 'boolean'
    ? sku.sku_stock
    : (Number.isFinite(stockCount) ? stockCount > 0 : null);
  const priceRaw = sku?.offer_sale_price ?? sku?.sku_price;
  const price = priceRaw == null ? null : Number(priceRaw);
  return {
    id: sku?.id == null ? null : String(sku.id),
    label: skuLabel(sku),
    inStock,
    stock: Number.isFinite(stockCount) ? stockCount : null,
    price: Number.isFinite(price) ? price : null,
    currency: sku?.currency_code || null
  };
}

async function callProduct(productId) {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  const accessToken = await getValidAccessToken();
  const params = {
    app_key: APP_KEY,
    access_token: accessToken,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    product_id: String(productId),
    ship_to_country: 'IL',
    target_currency: 'USD',
    target_language: 'EN'
  };
  params.sign = signAliExpress(params, secret, PRODUCT_PATH);
  const url = `${API_BASE}${PRODUCT_PATH}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  const errorCode = json?.code || json?.error_response?.sub_code || json?.error_response?.code;
  if (!response.ok || !json || errorCode) {
    const err = new Error(String(errorCode || `http_${response.status}`));
    err.code = String(errorCode || `http_${response.status}`);
    err.details = text.slice(0, 1200);
    throw err;
  }

  const root = json.aliexpress_ds_product_get_response || json;
  const result = root.result || json.result;
  if (!result) {
    const err = new Error('unexpected_product_response');
    err.code = 'unexpected_product_response';
    err.details = text.slice(0, 1200);
    throw err;
  }

  const base = result.ae_item_base_info_dto || result;
  const skus = skuRows(result).map(normalizedSku);
  return {
    productId: String(productId),
    status: base.product_status_type || result.product_status_type || null,
    title: base.subject || null,
    skus,
    rawCode: root.rsp_code || null,
    rawMessage: root.rsp_msg || null
  };
}

async function updateProduct(product, snapshot) {
  const { supabaseUrl } = config();
  const selected = product.supplier_sku_id
    ? snapshot.skus.find((s) => s.id === String(product.supplier_sku_id))
    : null;
  const availableSkus = snapshot.skus.filter((s) => s.inStock !== false);
  const fallback = availableSkus.find((s) => s.price != null) || snapshot.skus.find((s) => s.price != null) || null;
  const source = selected || fallback;
  const inStock = selected
    ? selected.inStock
    : (snapshot.status ? snapshot.status === 'onSelling' && availableSkus.length > 0 : null);

  const update = {
    supplier_in_stock: inStock,
    supplier_stock: selected?.stock ?? null,
    supplier_price: source?.price ?? null,
    supplier_currency: source?.currency || null,
    last_sync_at: new Date().toISOString(),
    supplier_sync_error: null,
    updated_at: new Date().toISOString()
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`product_sync_save_${response.status}`);
  return { selectedSku: selected || null, update };
}

async function markSyncError(productId, error) {
  const { supabaseUrl } = config();
  await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      supplier_sync_error: String(error.code || error.message || error).slice(0, 300),
      updated_at: new Date().toISOString()
    })
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const cron = isCron(req);
  if (!cron && !await requireAdmin(req, res)) return;

  try {
    const { supabaseUrl } = config();
    const syncAll = cron || String(req.query.sync || '') === 'all';

    if (syncAll) {
      if (!cron) return res.status(403).json({ ok: false, error: 'cron_only' });
      const db = await fetch(`${supabaseUrl}/rest/v1/products?select=*&active=eq.true&supplier=eq.aliexpress&supplier_product_id=not.is.null&order=sort_order.asc&limit=25`, { headers: dbHeaders() });
      if (!db.ok) throw new Error(`products_read_${db.status}`);
      const products = await db.json();
      const results = [];
      for (const product of products) {
        try {
          const snapshot = await callProduct(product.supplier_product_id);
          const saved = await updateProduct(product, snapshot);
          results.push({ id: product.id, ok: true, inStock: saved.update.supplier_in_stock, price: saved.update.supplier_price });
        } catch (error) {
          await markSyncError(product.id, error);
          results.push({ id: product.id, ok: false, error: String(error.code || error.message || error) });
        }
      }
      return res.status(200).json({ ok: true, synced: results.length, results });
    }

    const storeProductId = String(req.query.storeProductId || '').trim();
    const directProductId = String(req.query.productId || '').trim();
    let product = null;
    let productId = directProductId;

    if (storeProductId) {
      const db = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(storeProductId)}&select=*&limit=1`, { headers: dbHeaders() });
      if (!db.ok) throw new Error(`product_read_${db.status}`);
      product = (await db.json())[0] || null;
      if (!product) return res.status(404).json({ ok: false, error: 'product_not_found' });
      productId = String(product.supplier_product_id || '');
    }

    if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok: false, error: 'bad_product' });

    try {
      const snapshot = await callProduct(productId);
      let saved = null;
      if (product) saved = await updateProduct(product, snapshot);
      return res.status(200).json({ ok: true, snapshot, saved });
    } catch (error) {
      if (product) await markSyncError(product.id, error);
      return res.status(200).json({
        ok: false,
        error: String(error.code || error.message || error),
        waitingForAliExpressPermission: String(error.code || '').includes('InsufficientPermission')
      });
    }
  } catch (error) {
    console.error('aliexpress product sync', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
};
