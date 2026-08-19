const { serverConfig, serverHeaders } = require('./supabase-server');

function clean(value, max = 300) { return String(value == null ? '' : value).trim().slice(0, max); }
function money(value) { const n = Number(value); return value == null || !Number.isFinite(n) ? null : Number(n.toFixed(2)); }

async function upsertSupplierOffer(input) {
  const { supabaseUrl } = serverConfig();
  const row = {
    product_id: clean(input.productId, 80),
    provider: clean(input.provider, 40).toLowerCase(),
    supplier_id: clean(input.supplierId, 160),
    supplier_url: clean(input.supplierUrl, 2000) || null,
    supplier_product_id: clean(input.supplierProductId, 200),
    supplier_sku_id: clean(input.supplierSkuId, 200),
    supplier_sku_attr: clean(input.supplierSkuAttr, 1000) || null,
    variant_label: clean(input.variantLabel, 300) || null,
    product_price_ils: money(input.productPriceIls),
    shipping_price_ils: money(input.shippingPriceIls),
    in_stock: input.inStock == null ? null : input.inStock === true,
    stock_quantity: input.stockQuantity == null ? null : Math.max(0, Math.floor(Number(input.stockQuantity))),
    shipping_available: input.shippingAvailable == null ? null : input.shippingAvailable === true,
    destination_country: 'IL',
    estimated_delivery_days: input.estimatedDeliveryDays == null ? null : Math.max(0, Math.floor(Number(input.estimatedDeliveryDays))),
    equivalence_verified: input.equivalenceVerified === true,
    equivalence_verified_at: input.equivalenceVerified === true ? (input.equivalenceVerifiedAt || new Date().toISOString()) : null,
    fulfillment_supported: input.fulfillmentSupported === true,
    provider_snapshot: input.providerSnapshot && typeof input.providerSnapshot === 'object' ? input.providerSnapshot : {},
    last_sync_at: input.lastSyncAt || null,
    shipping_last_checked_at: input.shippingLastCheckedAt || null,
    sync_error: clean(input.syncError, 500) || null
  };
  if (!row.product_id || !row.provider || !row.supplier_id || !row.supplier_product_id || !row.supplier_sku_id) throw new Error('supplier_offer_identity_incomplete');
  const filter = `product_id=eq.${encodeURIComponent(row.product_id)}&provider=eq.${encodeURIComponent(row.provider)}&supplier_id=eq.${encodeURIComponent(row.supplier_id)}&supplier_product_id=eq.${encodeURIComponent(row.supplier_product_id)}&supplier_sku_id=eq.${encodeURIComponent(row.supplier_sku_id)}&select=id&limit=1`;
  const existingResponse = await fetch(`${supabaseUrl}/rest/v1/supplier_offers?${filter}`, { headers: serverHeaders() });
  if (!existingResponse.ok) throw new Error(`supplier_offer_read_${existingResponse.status}`);
  const existing = (await existingResponse.json())[0] || null;
  const response = await fetch(existing ? `${supabaseUrl}/rest/v1/supplier_offers?id=eq.${existing.id}` : `${supabaseUrl}/rest/v1/supplier_offers`, {
    method: existing ? 'PATCH' : 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`supplier_offer_write_${response.status}`);
  return row;
}

async function recordSupplierOfferSafely(input) {
  try { return await upsertSupplierOffer(input); }
  catch (error) {
    // Existing supplier synchronization must keep working while the new
    // migration is being rolled out or if the optimizer is intentionally off.
    console.warn('Supplier offer recording skipped:', error.message);
    return null;
  }
}

module.exports = { upsertSupplierOffer, recordSupplierOfferSafely };
