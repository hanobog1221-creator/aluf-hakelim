const crypto = require('crypto');
const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken } = require('../_lib/aliexpress');
const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { quoteAliExpressFreight, convertToIls, quoteCartShipping } = require('../_lib/shipping');
const { getFulfillmentCandidate } = require('../_lib/fulfillment');
const { buildPlaceOrderRequests, safePreview } = require('../_lib/aliexpress-order');

// AliExpress support explicitly instructed us to use this endpoint for DS product lookup.
// Do not fall back to /ds/products/simplequery or aliexpress.offer.ds.product.simplequery.
const PRODUCT_PATH = '/ds/product/get';
const VERIFIED_CAPTURE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function isCron(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && String(req.headers.authorization || '') === `Bearer ${secret}`;
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

function snapshotFromResult(productId, result, source) {
  if (!result || typeof result !== 'object') {
    const err = new Error('unexpected_product_response');
    err.code = 'unexpected_product_response';
    throw err;
  }
  const base = result.ae_item_base_info_dto || result;
  const skus = skuRows(result).map(normalizedSku).filter((sku) => sku.id);
  return {
    productId: String(productId),
    status: base.product_status_type || result.product_status_type || null,
    title: base.subject || null,
    skus,
    source
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
    err.apiPath = PRODUCT_PATH;
    throw err;
  }

  const root = json.aliexpress_ds_product_get_response || json;
  const result = root.result || json.result || root;
  const snapshot = snapshotFromResult(productId, result, 'rest_ds_product_get');
  if (!snapshot.skus.length && !snapshot.status) {
    const err = new Error('product_get_empty');
    err.code = 'product_get_empty';
    err.apiPath = PRODUCT_PATH;
    throw err;
  }
  console.log('AliExpress product lookup succeeded', PRODUCT_PATH, String(productId));
  return snapshot;
}

async function writeSyncHistory(product, row) {
  try {
    const { supabaseUrl } = config();
    await fetch(`${supabaseUrl}/rest/v1/supplier_sync_history`, {
      method: 'POST',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        store_product_id: String(product.id),
        supplier_product_id: product.supplier_product_id || row.supplierProductId || null,
        supplier_sku_id: product.supplier_sku_id || null,
        in_stock: row.inStock ?? null,
        stock: row.stock ?? null,
        price: row.price ?? null,
        currency: row.currency || null,
        price_ils: row.priceIls ?? null,
        shipping_available: row.shippingAvailable ?? null,
        shipping_ils: row.shippingIls ?? null,
        sync_error: row.error ? String(row.error).slice(0, 300) : null
      })
    });
  } catch (error) {
    console.error('supplier sync history write failed', error);
  }
}

async function updateProduct(product, snapshot) {
  const { supabaseUrl } = config();
  const selectedId = product.supplier_sku_id ? String(product.supplier_sku_id) : null;
  const selected = selectedId ? snapshot.skus.find((s) => s.id === selectedId) || null : null;
  const selectedMissing = Boolean(selectedId && !selected);
  const availableSkus = snapshot.skus.filter((s) => s.inStock !== false);
  const fallback = availableSkus.find((s) => s.price != null) || snapshot.skus.find((s) => s.price != null) || null;
  const source = selected || fallback;
  const inStock = selected
    ? selected.inStock
    : (snapshot.status ? snapshot.status === 'onSelling' && availableSkus.length > 0 : null);

  let supplierPriceIls = null;
  if (source?.price != null && source?.currency) {
    try {
      supplierPriceIls = await convertToIls(source.price, source.currency);
    } catch {
      supplierPriceIls = null;
    }
  }

  let freight = null;
  let shippingError = null;
  try {
    freight = await quoteAliExpressFreight({
      productId: product.supplier_product_id || snapshot.productId,
      qty: 1,
      countryCode: 'IL',
      shipFromCountry: product.supplier_ship_from_country || 'CN'
    });
  } catch (error) {
    shippingError = String(error.code || error.message || error).slice(0, 300);
  }

  const now = new Date().toISOString();
  const skuVerified = Boolean(selected);
  const shippingAvailable = Boolean(freight);
  const ready = Boolean(
    product.active === true &&
    skuVerified &&
    selected.inStock === true &&
    shippingAvailable &&
    supplierPriceIls != null
  );

  const update = {
    supplier_in_stock: selectedMissing ? false : inStock,
    supplier_stock: selected?.stock ?? null,
    supplier_price: source?.price ?? null,
    supplier_currency: source?.currency || null,
    supplier_price_ils: supplierPriceIls,
    last_sync_at: now,
    supplier_sync_error: selectedMissing ? 'selected_sku_missing' : null,
    shipping_sync_error: shippingError,
    sku_verified_at: skuVerified ? now : null,
    sku_verified_by: skuVerified ? 'supplier_sync' : null,
    fulfillment_ready: ready,
    updated_at: now
  };

  if (freight) {
    update.supplier_shipping = freight.amountIls;
    update.shipping_currency = 'ILS';
    update.supplier_shipping_available = true;
    update.shipping_last_checked_at = now;
  } else if (shippingError === 'no_shipping_option') {
    update.supplier_shipping = null;
    update.shipping_currency = null;
    update.supplier_shipping_available = false;
    update.shipping_last_checked_at = now;
  } else {
    update.supplier_shipping_available = null;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`product_sync_save_${response.status}_${details.slice(0, 200)}`);
  }

  await writeSyncHistory(product, {
    supplierProductId: snapshot.productId,
    inStock: update.supplier_in_stock,
    stock: update.supplier_stock,
    price: update.supplier_price,
    currency: update.supplier_currency,
    priceIls: update.supplier_price_ils,
    shippingAvailable: update.supplier_shipping_available ?? null,
    shippingIls: Object.prototype.hasOwnProperty.call(update, 'supplier_shipping') ? update.supplier_shipping : null,
    error: update.supplier_sync_error || null
  });

  return { selectedSku: selected, skuVerified, ready, update, freight };
}

function hasFreshVerifiedPdp(product) {
  const source = String(product.sku_verified_by || '');
  const verifiedAt = Date.parse(product.sku_verified_at || '');
  const productAt = Date.parse(product.last_sync_at || '');
  const shippingAt = Date.parse(product.shipping_last_checked_at || '');
  const now = Date.now();
  return Boolean(
    source.startsWith('aliexpress_pdp') &&
    Number.isFinite(verifiedAt) && now - verifiedAt <= VERIFIED_CAPTURE_MAX_AGE_MS &&
    Number.isFinite(productAt) && now - productAt <= VERIFIED_CAPTURE_MAX_AGE_MS &&
    Number.isFinite(shippingAt) && now - shippingAt <= VERIFIED_CAPTURE_MAX_AGE_MS &&
    product.supplier_sku_id &&
    product.supplier_in_stock === true &&
    product.supplier_price_ils != null &&
    product.supplier_shipping_available === true
  );
}

async function markSyncError(product, error) {
  const { supabaseUrl } = config();
  const message = String(error.code || error.message || error).slice(0, 300);
  const permissionError = /permission|authorize/i.test(message);
  const preservedVerifiedData = permissionError && hasFreshVerifiedPdp(product);

  if (!preservedVerifiedData) {
    await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
      method: 'PATCH',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        supplier_sync_error: message,
        fulfillment_ready: false,
        updated_at: new Date().toISOString()
      })
    }).catch(() => {});
  }

  await writeSyncHistory(product, { error: message });
  return { preservedVerifiedData };
}

async function recordPreparedAttempt(orderId, requestFingerprint) {
  const { supabaseUrl } = config();
  await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&status=eq.prepared`, {
    method: 'PATCH',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'cancelled' })
  }).catch(() => {});

  const response = await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      order_id: orderId,
      request_fingerprint: requestFingerprint,
      status: 'prepared'
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`attempt_journal_failed_${response.status}_${details.slice(0, 120)}`);
  }
  return (await response.json())[0] || null;
}

async function handleAttempts(req, res) {
  try {
    const { supabaseUrl } = config();
    const orderId = String(req.query?.orderId || '').trim().toUpperCase();
    const limitRaw = Number(req.query?.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
    if (orderId && !/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    }
    const filter = orderId ? `&order_id=eq.${encodeURIComponent(orderId)}` : '';
    const response = await fetch(
      `${supabaseUrl}/rest/v1/supplier_order_attempts?select=id,order_id,attempt_key,request_fingerprint,status,supplier_order_ids,error_code,error_message,created_at,updated_at${filter}&order=created_at.desc&limit=${limit}`,
      { headers: dbHeaders() }
    );
    if (!response.ok) throw new Error(`supplier_attempts_read_${response.status}`);
    const attempts = await response.json();
    return res.status(200).json({
      ok: true,
      attempts: attempts.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        attemptKey: row.attempt_key,
        requestFingerprint: row.request_fingerprint,
        status: row.status,
        supplierOrderIds: Array.isArray(row.supplier_order_ids) ? row.supplier_order_ids : [],
        errorCode: row.error_code || null,
        errorMessage: row.error_message ? String(row.error_message).slice(0, 300) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('supplier attempts read failed', error);
    return res.status(500).json({ ok: false, error: 'supplier_attempts_failed' });
  }
}

async function handleOrderPreflight(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim().toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    }

    const { order, validation } = await getFulfillmentCandidate(orderId);
    if (!validation.ok) {
      await audit('supplier_order_preflight_blocked', 'order', orderId, {
        reason: validation.reason,
        productId: validation.productId || null
      });
      return res.status(409).json({ ok: false, error: 'preflight_blocked', validation });
    }

    const shippingLines = (Array.isArray(order.items) ? order.items : []).map((item) => ({
      id: String(item.id || ''),
      qty: Number(item.qty || 0),
      supplierProductId: item.supplierProductId,
      supplierShipFromCountry: item.supplierShipFromCountry || 'CN'
    }));
    const freshShipping = await quoteCartShipping(shippingLines, 'IL');
    const chargedShipping = Number(order.shipping_cost || 0);
    const currentShipping = Number(freshShipping.total || 0);
    if (!Number.isFinite(currentShipping) || currentShipping > chargedShipping + 0.01) {
      const shippingValidation = {
        ok: false,
        reason: 'supplier_shipping_price_increased',
        chargedShipping,
        currentShipping: Number.isFinite(currentShipping) ? currentShipping : null
      };
      await audit('supplier_order_preflight_blocked', 'order', orderId, shippingValidation);
      return res.status(409).json({ ok: false, error: 'preflight_blocked', validation: shippingValidation });
    }

    const supplierRequests = buildPlaceOrderRequests(order, freshShipping);
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(supplierRequests), 'utf8')
      .digest('hex');
    const attempt = await recordPreparedAttempt(orderId, requestFingerprint);

    await audit('supplier_order_preflight_ready', 'order', orderId, {
      items: supplierRequests.reduce((sum, group) => sum + group.request.product_items.length, 0),
      supplierGroups: supplierRequests.length,
      requestFingerprint,
      attemptId: attempt?.id || null,
      chargedShipping,
      currentShipping
    });

    return res.status(200).json({
      ok: true,
      dryRun: true,
      orderId,
      validation,
      requestFingerprint,
      attemptId: attempt?.id || null,
      chargedShipping,
      freshSupplierShipping: currentShipping,
      shippingCovered: currentShipping <= chargedShipping + 0.01,
      supplierOrders: supplierRequests.map((group) => ({
        supplierId: group.supplierId,
        preview: safePreview(group.request)
      })),
      liveSupplierRequestSent: false,
      nextStep: 'supplier_place_order_endpoint_not_enabled'
    });
  } catch (error) {
    const message = String(error.message || error);
    console.error('supplier order preflight failed', message);
    return res.status(400).json({ ok: false, error: 'preflight_failed', detail: message.slice(0, 180) });
  }
}

async function handleProductSync(req, res, cron) {
  try {
    const { supabaseUrl } = config();
    const syncAll = cron || String(req.query?.sync || '') === 'all';

    if (syncAll) {
      const db = await fetch(`${supabaseUrl}/rest/v1/products?select=*&active=eq.true&supplier=eq.aliexpress&supplier_product_id=not.is.null&order=sort_order.asc&limit=25`, { headers: dbHeaders() });
      if (!db.ok) throw new Error(`products_read_${db.status}`);
      const products = await db.json();
      const results = [];
      for (const product of products) {
        try {
          const snapshot = await callProduct(product.supplier_product_id);
          const saved = await updateProduct(product, snapshot);
          results.push({
            id: product.id,
            ok: true,
            source: snapshot.source || null,
            skuVerified: saved.skuVerified,
            ready: saved.ready,
            inStock: saved.update.supplier_in_stock,
            price: saved.update.supplier_price,
            priceIls: saved.update.supplier_price_ils,
            shipping: saved.update.supplier_shipping ?? null,
            shippingAvailable: saved.update.supplier_shipping_available ?? null,
            shippingError: saved.update.shipping_sync_error || null,
            supplierError: saved.update.supplier_sync_error || null
          });
        } catch (error) {
          const marked = await markSyncError(product, error);
          results.push({ id: product.id, ok: false, error: String(error.code || error.message || error), preservedVerifiedData: marked.preservedVerifiedData });
        }
      }
      return res.status(200).json({ ok: true, synced: results.length, results });
    }

    const storeProductId = String(req.query?.storeProductId || '').trim();
    const directProductId = String(req.query?.productId || '').trim();
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
      let marked = { preservedVerifiedData: false };
      if (product) marked = await markSyncError(product, error);
      const errorText = String(error.code || error.message || error);
      return res.status(200).json({
        ok: false,
        error: errorText,
        waitingForAliExpressPermission: /permission|authorize/i.test(errorText),
        preservedVerifiedData: marked.preservedVerifiedData
      });
    }
  } catch (error) {
    console.error('aliexpress product sync', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const action = String(req.query?.action || '').trim();

  if (req.method === 'GET' && action === 'attempts') {
    if (!await requireAdmin(req, res)) return;
    return handleAttempts(req, res);
  }

  if (req.method === 'POST' && action === 'order-preflight') {
    if (!await requireAdmin(req, res)) return;
    return handleOrderPreflight(req, res);
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const cron = isCron(req);
  if (!cron && !await requireAdmin(req, res)) return;
  return handleProductSync(req, res, cron);
};