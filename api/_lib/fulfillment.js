async function loadOrderForFulfillment(orderId) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');

  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(String(orderId || ''))}&select=order_id,status,payment_status,fulfillment_status,currency,total,shipping_cost,shipping_quote_status,shipping_quote,shipping_quoted_at,items,customer,supplier_order_id,last_error&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error(`order_read_${response.status}`);
  const rows = await response.json();
  const order = rows[0];
  if (!order) throw new Error('order_not_found');
  return order;
}

function validateFulfillmentOrder(order) {
  if (order.payment_status !== 'paid') return { ok: false, reason: 'payment_not_confirmed' };
  if (order.shipping_quote_status !== 'quoted') return { ok: false, reason: 'shipping_not_quoted' };
  if (order.supplier_order_id) return { ok: false, reason: 'supplier_order_already_exists' };
  if (!['not_started', 'retry'].includes(order.fulfillment_status)) {
    return { ok: false, reason: 'fulfillment_not_eligible' };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return { ok: false, reason: 'no_items' };

  for (const item of items) {
    if (item.supplier !== 'aliexpress') return { ok: false, reason: 'unsupported_supplier', productId: item.id };
    if (!item.fulfillmentReady || !item.supplierProductId || !item.supplierSkuId) {
      return { ok: false, reason: 'supplier_sku_not_verified', productId: item.id };
    }
    const qty = Number(item.qty || 0);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return { ok: false, reason: 'invalid_quantity', productId: item.id };
    }
  }

  const customer = order.customer || {};
  if (!customer.fullName || !customer.phone || !customer.city || !customer.street || !customer.houseNumber) {
    return { ok: false, reason: 'shipping_address_incomplete' };
  }

  return { ok: true };
}

async function getFulfillmentCandidate(orderId) {
  const order = await loadOrderForFulfillment(orderId);
  const validation = validateFulfillmentOrder(order);
  return { order, validation };
}

module.exports = { loadOrderForFulfillment, validateFulfillmentOrder, getFulfillmentCandidate };
