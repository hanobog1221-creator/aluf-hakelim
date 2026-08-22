const { serverHeaders } = require('./supabase-server');
const { productAutomationStatus } = require('./product-readiness');

async function dbJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`payment_readiness_failed_${response.status}`);
  return response.json();
}

async function checkOrderPaymentReadiness(orderId) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  const id = String(orderId || '').trim().toUpperCase();
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(id)) throw new Error('invalid_order_id');
  const headers = serverHeaders({}, serviceKey);
  const [orders, settingsRows] = await Promise.all([
    dbJson(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(id)}&select=order_id,status,payment_status,currency,total,shipping_cost,shipping_quote_status,shipping_quoted_at,terms_accepted_at,terms_version,coupon_code,items,supplier_order_id,supplier_order_ids&limit=1`, { headers }),
    dbJson(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=*&limit=1`, { headers })
  ]);
  const order = orders[0];
  const settings = settingsRows[0] || {};
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (settings.sales_enabled !== true) return { ok: false, reason: 'sales_disabled' };
  if (!['draft', 'payment_pending'].includes(String(order.status))) return { ok: false, reason: 'order_status_not_payable' };
  if (!['unpaid', 'failed'].includes(String(order.payment_status))) return { ok: false, reason: 'payment_already_in_progress_or_complete' };
  if (!order.terms_accepted_at || !String(order.terms_version || '').trim()) return { ok: false, reason: 'terms_not_recorded' };
  if (order.shipping_quote_status !== 'quoted' || !order.shipping_quoted_at) return { ok: false, reason: 'shipping_not_quoted' };
  const ttlMinutes = Math.max(5, Math.min(180, Number(settings.payment_quote_ttl_minutes || 30)));
  const quotedAt = Date.parse(order.shipping_quoted_at);
  if (!Number.isFinite(quotedAt) || Date.now() - quotedAt > ttlMinutes * 60_000 || quotedAt > Date.now() + 60_000) return { ok: false, reason: 'shipping_quote_stale' };
  if (order.supplier_order_id || (Array.isArray(order.supplier_order_ids) && order.supplier_order_ids.length)) return { ok: false, reason: 'supplier_order_already_exists' };
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return { ok: false, reason: 'order_items_missing' };

  if (order.coupon_code) {
    const rows = await dbJson(`${supabaseUrl}/rest/v1/coupons?code=eq.${encodeURIComponent(order.coupon_code)}&select=active,starts_at,ends_at,usage_limit,used_count&limit=1`, { headers });
    const coupon = rows[0];
    if (!coupon || coupon.active !== true) return { ok: false, reason: 'coupon_unavailable' };
    if (coupon.starts_at && Date.parse(coupon.starts_at) > Date.now()) return { ok: false, reason: 'coupon_not_started' };
    if (coupon.ends_at && Date.parse(coupon.ends_at) < Date.now()) return { ok: false, reason: 'coupon_expired' };
    if (coupon.usage_limit != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) return { ok: false, reason: 'coupon_limit_reached' };
  }

  const ids = [...new Set(items.map((item) => String(item.id || '')).filter(Boolean))];
  const products = await dbJson(`${supabaseUrl}/rest/v1/products?select=*&id=in.(${encodeURIComponent(ids.join(','))})`, { headers });
  const byId = new Map(products.map((product) => [String(product.id), product]));
  for (const item of items) {
    if (item.fulfillmentReady !== true) return { ok: false, reason: 'order_snapshot_not_fulfillment_ready', productId: item.id };
    const product = byId.get(String(item.id));
    if (!product) return { ok: false, reason: 'product_not_found', productId: item.id };
    const status = productAutomationStatus(product, settings);
    if (!status.ready) return { ok: false, reason: 'current_product_not_ready', productId: item.id, blockers: status.blockers };
    if (String(product.supplier_product_id || '') !== String(item.supplierProductId || '') || String(product.supplier_sku_id || '') !== String(item.supplierSkuId || '')) return { ok: false, reason: 'supplier_mapping_changed', productId: item.id };
    if (String(product.supplier || '').toLowerCase() === 'aliexpress' && String(product.supplier_sku_attr || '') !== String(item.supplierSkuAttr || '')) return { ok: false, reason: 'supplier_mapping_changed', productId: item.id };
  }

  const amount = Number((Number(order.total || 0) + Number(order.shipping_cost || 0)).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return { ok: false, reason: 'invalid_order_amount' };
  return { ok: true, orderId: id, amount, currency: order.currency, shippingQuotedAt: order.shipping_quoted_at, quoteTtlMinutes: ttlMinutes, termsVersion: order.terms_version, couponCode: order.coupon_code };
}

async function requireOrderPaymentReadiness(orderId) {
  const result = await checkOrderPaymentReadiness(orderId);
  if (result.ok !== true) {
    const error = new Error(String(result.reason || 'order_not_ready_for_payment'));
    error.code = String(result.reason || 'order_not_ready_for_payment');
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = { checkOrderPaymentReadiness, requireOrderPaymentReadiness };
