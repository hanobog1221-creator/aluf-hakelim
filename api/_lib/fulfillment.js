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

async function loadCurrentSupplierState(order) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const ids = [...new Set((Array.isArray(order.items) ? order.items : []).map((item) => String(item.id || '')).filter(Boolean))];

  const [productsResponse, settingsResponse] = await Promise.all([
    ids.length
      ? fetch(`${supabaseUrl}/rest/v1/products?select=id,active,max_order_quantity,supplier,supplier_product_id,supplier_sku_id,fulfillment_ready,supplier_price_ils,supplier_in_stock,supplier_shipping_available,last_sync_at,shipping_last_checked_at&id=in.(${encodeURIComponent(ids.join(','))})`, { headers })
      : Promise.resolve({ ok: true, json: async () => [] }),
    fetch(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=minimum_profit_ils&limit=1`, { headers })
  ]);

  if (!productsResponse.ok) throw new Error(`supplier_state_read_${productsResponse.status}`);
  if (!settingsResponse.ok) throw new Error(`store_settings_read_${settingsResponse.status}`);
  const products = await productsResponse.json();
  const settings = (await settingsResponse.json())[0] || {};
  return {
    products: new Map(products.map((product) => [String(product.id), product])),
    settings
  };
}

function validateFulfillmentOrder(order, supplierState = null) {
  if (order.payment_status !== 'paid') return { ok: false, reason: 'payment_not_confirmed' };
  if (order.shipping_quote_status !== 'quoted') return { ok: false, reason: 'shipping_not_quoted' };
  if (order.supplier_order_id) return { ok: false, reason: 'supplier_order_already_exists' };
  if (!['not_started', 'retry'].includes(order.fulfillment_status)) {
    return { ok: false, reason: 'fulfillment_not_eligible' };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return { ok: false, reason: 'no_items' };

  const currentProducts = supplierState?.products || null;
  const minProfitRaw = supplierState?.settings?.minimum_profit_ils;
  const minimumProfit = minProfitRaw == null ? null : Number(minProfitRaw);

  for (const item of items) {
    if (item.supplier !== 'aliexpress') return { ok: false, reason: 'unsupported_supplier', productId: item.id };
    if (!item.fulfillmentReady || !item.supplierProductId || !item.supplierSkuId) {
      return { ok: false, reason: 'supplier_sku_not_verified', productId: item.id };
    }
    const qty = Number(item.qty || 0);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return { ok: false, reason: 'invalid_quantity', productId: item.id };
    }

    if (currentProducts) {
      const current = currentProducts.get(String(item.id));
      if (!current || current.active !== true) return { ok: false, reason: 'product_inactive', productId: item.id };
      const maxQty = Math.max(1, Math.min(100, Number(current.max_order_quantity || 20)));
      if (qty > maxQty) return { ok: false, reason: 'quantity_limit_changed', productId: item.id, maxQty };
      if (current.supplier !== 'aliexpress') return { ok: false, reason: 'supplier_changed', productId: item.id };
      if (!current.fulfillment_ready || !current.supplier_product_id || !current.supplier_sku_id) {
        return { ok: false, reason: 'current_supplier_mapping_not_ready', productId: item.id };
      }
      if (String(current.supplier_product_id) !== String(item.supplierProductId) || String(current.supplier_sku_id) !== String(item.supplierSkuId)) {
        return { ok: false, reason: 'supplier_mapping_changed', productId: item.id };
      }
      if (current.supplier_in_stock === false) return { ok: false, reason: 'supplier_out_of_stock', productId: item.id };
      if (current.supplier_shipping_available === false) return { ok: false, reason: 'supplier_shipping_unavailable', productId: item.id };

      if (Number.isFinite(minimumProfit)) {
        const supplierCost = current.supplier_price_ils == null ? null : Number(current.supplier_price_ils);
        const salePrice = Number(item.price);
        if (!Number.isFinite(supplierCost)) return { ok: false, reason: 'supplier_price_unknown', productId: item.id };
        if (!Number.isFinite(salePrice)) return { ok: false, reason: 'sale_price_invalid', productId: item.id };
        const profitPerUnit = Number((salePrice - supplierCost).toFixed(2));
        if (profitPerUnit < minimumProfit) {
          return {
            ok: false,
            reason: 'minimum_profit_not_met',
            productId: item.id,
            profitPerUnit,
            minimumProfit
          };
        }
      }
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
  const supplierState = await loadCurrentSupplierState(order);
  const validation = validateFulfillmentOrder(order, supplierState);
  return { order, validation };
}

module.exports = {
  loadOrderForFulfillment,
  loadCurrentSupplierState,
  validateFulfillmentOrder,
  getFulfillmentCandidate
};
