const { serverHeaders } = require('./supabase-server');

const MAX_SUPPLIER_STATE_AGE_MS = 8 * 60 * 60 * 1000;
const SUPPORTED_SUPPLIERS = new Set(['aliexpress', 'cj']);

async function loadOrderForFulfillment(orderId) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(String(orderId || ''))}&select=order_id,status,payment_status,fulfillment_status,currency,total,shipping_cost,shipping_quote_status,shipping_quote,shipping_quoted_at,items,customer,supplier_order_id,supplier_order_ids,last_error,updated_at&limit=1`, { headers: serverHeaders({}, serviceKey) });
  if (!response.ok) throw new Error(`order_read_${response.status}`);
  const order = (await response.json())[0];
  if (!order) throw new Error('order_not_found');
  return order;
}

async function loadCurrentSupplierState(order) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  const headers = serverHeaders({}, serviceKey);
  const ids = [...new Set((Array.isArray(order.items) ? order.items : []).map((item) => String(item.id || '')).filter(Boolean))];
  const [productsResponse, settingsResponse] = await Promise.all([
    ids.length ? fetch(`${supabaseUrl}/rest/v1/products?select=id,name,active,max_order_quantity,supplier,supplier_id,supplier_product_id,supplier_sku_id,supplier_sku_attr,alternative_suppliers,fulfillment_ready,fulfillment_provider,fulfillment_product_id,fulfillment_variant_id,fulfillment_sku,fulfillment_origin_country,fulfillment_logistic_name,fulfillment_provider_status,fulfillment_verified_at,supplier_price_ils,supplier_shipping,supplier_in_stock,supplier_shipping_available,last_sync_at,shipping_last_checked_at,minimum_profit,auto_fulfill_max_cost&id=in.(${encodeURIComponent(ids.join(','))})`, { headers }) : Promise.resolve({ ok: true, json: async () => [] }),
    fetch(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=*&limit=1`, { headers })
  ]);
  if (!productsResponse.ok) throw new Error(`supplier_state_read_${productsResponse.status}`);
  if (!settingsResponse.ok) throw new Error(`store_settings_read_${settingsResponse.status}`);
  const products = await productsResponse.json();
  const settings = (await settingsResponse.json())[0] || {};
  return { products: new Map(products.map((product) => [String(product.id), product])), settings };
}

function stateIsFresh(value) { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) && Date.now() - time <= MAX_SUPPLIER_STATE_AGE_MS; }
function hasSupplierOrder(order) { return Boolean(order.supplier_order_id) || (Array.isArray(order.supplier_order_ids) && order.supplier_order_ids.length > 0); }
function providerOf(value) { return String(value || '').trim().toLowerCase(); }
function currentSupplierMapping(product, item) {
  const itemSupplier = providerOf(item.supplier), currentSupplier = providerOf(product.supplier || product.fulfillment_provider);
  const currentAttrMatches = itemSupplier !== 'aliexpress' || (
    Boolean(item.supplierSkuAttr) &&
    String(product.supplier_sku_attr || '') === String(item.supplierSkuAttr || '')
  );
  if (
    itemSupplier === currentSupplier &&
    (!item.supplierId || String(product.supplier_id || '') === String(item.supplierId || '')) &&
    String(product.supplier_product_id || '') === String(item.supplierProductId || '') &&
    String(product.supplier_sku_id || '') === String(item.supplierSkuId || '') &&
    currentAttrMatches
  ) return product;
  if (itemSupplier !== 'aliexpress') return null;
  return (Array.isArray(product.alternative_suppliers) ? product.alternative_suppliers : []).find((candidate) => {
    const candidateAttr = candidate.supplier_sku_attr || candidate.supplierSkuAttr || candidate.sku_attr || candidate.skuAttr || '';
    return candidate.verified === true
      && providerOf(candidate.supplier || 'aliexpress') === itemSupplier
      && String(candidate.supplier_id || candidate.supplierId || '') === String(item.supplierId || '')
      && String(candidate.supplier_product_id || candidate.supplierProductId || '') === String(item.supplierProductId || '')
      && String(candidate.supplier_sku_id || candidate.supplierSkuId || '') === String(item.supplierSkuId || '')
      && Boolean(item.supplierSkuAttr)
      && String(candidateAttr) === String(item.supplierSkuAttr || '');
  }) || null;
}
function currentMappingReady(current, itemSupplier) {
  if (!current.fulfillment_ready || !current.supplier_product_id || !current.supplier_sku_id) return false;
  if (itemSupplier === 'aliexpress' && !current.supplier_sku_attr) return false;
  if (itemSupplier === 'cj') return providerOf(current.fulfillment_provider) === 'cj' && Boolean(current.fulfillment_product_id) && Boolean(current.fulfillment_variant_id) && Boolean(current.fulfillment_sku) && Boolean(current.fulfillment_verified_at) && String(current.fulfillment_product_id) === String(current.supplier_product_id) && String(current.fulfillment_variant_id) === String(current.supplier_sku_id);
  return true;
}

function validateFulfillmentOrder(order, supplierState = null, options = {}) {
  if (!options.ignoreSalesDisabled && supplierState?.settings && supplierState.settings.sales_enabled !== true) return { ok: false, reason: 'sales_disabled' };
  if (order.payment_status !== 'paid') return { ok: false, reason: 'payment_not_confirmed' };
  if (order.shipping_quote_status !== 'quoted') return { ok: false, reason: 'shipping_not_quoted' };
  if (hasSupplierOrder(order)) return { ok: false, reason: 'supplier_order_already_exists' };
  if (!['not_started', 'ready', 'failed'].includes(order.fulfillment_status)) return { ok: false, reason: 'fulfillment_not_eligible' };
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return { ok: false, reason: 'no_items' };
  const currentProducts = supplierState?.products || null;
  const globalMinProfitRaw = supplierState?.settings?.minimum_profit_ils;
  const globalMinimumProfit = globalMinProfitRaw == null ? null : Number(globalMinProfitRaw);
  for (const item of items) {
    const itemSupplier = providerOf(item.supplier);
    if (!SUPPORTED_SUPPLIERS.has(itemSupplier)) return { ok: false, reason: 'unsupported_supplier', productId: item.id };
    if (!item.fulfillmentReady || !item.supplierProductId || !item.supplierSkuId) return { ok: false, reason: 'supplier_sku_not_verified', productId: item.id };
    if (itemSupplier === 'aliexpress' && !item.supplierSkuAttr) return { ok: false, reason: 'supplier_sku_attr_not_verified', productId: item.id };
    const qty = Number(item.qty || 0);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return { ok: false, reason: 'invalid_quantity', productId: item.id };
    if (currentProducts) {
      const current = currentProducts.get(String(item.id));
      if (!current || current.active !== true) return { ok: false, reason: 'product_inactive', productId: item.id };
      const maxQty = Math.max(1, Math.min(20, Number(current.max_order_quantity || 20)));
      if (qty > maxQty) return { ok: false, reason: 'quantity_limit_changed', productId: item.id, maxQty };
      const mapping = currentSupplierMapping(current, item);
      if (!mapping) return { ok: false, reason: 'supplier_mapping_changed', productId: item.id };
      const mappingSupplier = providerOf(mapping.supplier || current.supplier || current.fulfillment_provider);
      if (mappingSupplier !== itemSupplier) return { ok: false, reason: 'supplier_changed', productId: item.id };
      if (mapping === current && !currentMappingReady(current, itemSupplier)) return { ok: false, reason: 'current_supplier_mapping_not_ready', productId: item.id };
      const inStock = mapping === current ? current.supplier_in_stock : mapping.in_stock;
      const shippingAvailable = mapping === current ? current.supplier_shipping_available : mapping.shipping_available;
      if (inStock !== true) return { ok: false, reason: inStock === false ? 'supplier_out_of_stock' : 'supplier_stock_unknown', productId: item.id };
      if (shippingAvailable !== true) return { ok: false, reason: shippingAvailable === false ? 'supplier_shipping_unavailable' : 'supplier_shipping_unknown', productId: item.id };
      const lastSyncAt = mapping === current ? current.last_sync_at : (mapping.last_sync_at || mapping.lastSyncAt);
      const shippingLastCheckedAt = mapping === current ? current.shipping_last_checked_at : (mapping.shipping_last_checked_at || mapping.shippingLastCheckedAt);
      if (!stateIsFresh(lastSyncAt)) return { ok: false, reason: 'supplier_product_sync_stale', productId: item.id, lastSyncAt: lastSyncAt || null };
      if (!stateIsFresh(shippingLastCheckedAt)) return { ok: false, reason: 'supplier_shipping_sync_stale', productId: item.id, shippingLastCheckedAt: shippingLastCheckedAt || null };
      const supplierPriceRaw = mapping === current ? current.supplier_price_ils : (mapping.supplier_price_ils ?? mapping.supplierPriceIls);
      const supplierShippingRaw = mapping === current ? current.supplier_shipping : (mapping.supplier_shipping ?? mapping.supplierShipping);
      const supplierPrice = supplierPriceRaw == null ? null : Number(supplierPriceRaw), supplierShipping = supplierShippingRaw == null ? null : Number(supplierShippingRaw), salePrice = Number(item.price);
      if (!Number.isFinite(supplierPrice)) return { ok: false, reason: 'supplier_price_unknown', productId: item.id };
      if (!Number.isFinite(salePrice)) return { ok: false, reason: 'sale_price_invalid', productId: item.id };
      const maxSupplierCostRaw = current.auto_fulfill_max_cost;
      if (maxSupplierCostRaw != null) {
        const maxSupplierCost = Number(maxSupplierCostRaw), totalSupplierCost = Number((supplierPrice + (Number.isFinite(supplierShipping) ? supplierShipping : 0)).toFixed(2));
        if (Number.isFinite(maxSupplierCost) && totalSupplierCost > maxSupplierCost) return { ok: false, reason: 'supplier_cost_above_auto_limit', productId: item.id, totalSupplierCost, maxSupplierCost };
      }
      const productMinProfitRaw = current.minimum_profit, productMinimumProfit = productMinProfitRaw == null ? null : Number(productMinProfitRaw), configuredMinimumProfit = Number.isFinite(productMinimumProfit) ? productMinimumProfit : globalMinimumProfit;
      const minimumProfit = Number.isFinite(configuredMinimumProfit) ? Math.max(25, configuredMinimumProfit) : null;
      if (!Number.isFinite(minimumProfit)) return { ok: false, reason: 'minimum_profit_not_configured', productId: item.id };
      const paymentFeePercent = Number(supplierState?.settings?.pricing_fee_percent || 0);
      const paymentFeeFixed = Number(supplierState?.settings?.pricing_fee_fixed_ils || 0);
      const pricingReserve = Number(supplierState?.settings?.pricing_reserve_ils || 0);
      const feeBase = salePrice + (Number.isFinite(supplierShipping) ? supplierShipping : 0);
      const estimatedPaymentFee = Number((feeBase * paymentFeePercent / 100 + paymentFeeFixed / items.length).toFixed(2));
      const preTaxProfit = Number((salePrice - supplierPrice - estimatedPaymentFee - pricingReserve).toFixed(2));
      const taxReservePercent = Number(supplierState?.settings?.pricing_tax_reserve_percent ?? 22);
      const insuranceReservePercent = Number(supplierState?.settings?.pricing_insurance_reserve_percent ?? 18);
      const profitPerUnit = Number((preTaxProfit * (1 - (taxReservePercent + insuranceReservePercent) / 100)).toFixed(2));
      if (profitPerUnit < minimumProfit) return { ok: false, reason: 'minimum_profit_not_met', productId: item.id, profitPerUnit, minimumProfit };
    }
  }
  const customer = order.customer || {};
  if (!customer.fullName || !customer.phone || !customer.city || !customer.street || !customer.houseNumber) return { ok: false, reason: 'shipping_address_incomplete' };
  return { ok: true };
}

async function getFulfillmentCandidate(orderId, options = {}) {
  const order = await loadOrderForFulfillment(orderId), supplierState = await loadCurrentSupplierState(order), validation = validateFulfillmentOrder(order, supplierState, options);
  return { order, validation, supplierState };
}

module.exports = { MAX_SUPPLIER_STATE_AGE_MS, SUPPORTED_SUPPLIERS, loadOrderForFulfillment, loadCurrentSupplierState, validateFulfillmentOrder, getFulfillmentCandidate };
