const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { requireWorker } = require('../cj-worker-auth');
const { pricingPolicy } = require('../pricing-engine');
const { verifiedCjReadiness } = require('./cj-worker-catalog');
const {
  DEFAULT_MINIMUM_PROFIT_ILS,
  DEFAULT_TAX_RESERVE_PERCENT,
  DEFAULT_INSURANCE_RESERVE_PERCENT,
  AUTO_FULFILLMENT_PROVIDERS,
  selectBestOffer,
  pricingForOffer
} = require('../supplier-optimizer');

function clean(value, max = 200) { return String(value == null ? '' : value).trim().slice(0, max); }
function numberOrNull(value) { const n = Number(value); return value === null || value === '' || !Number.isFinite(n) ? null : Number(n.toFixed(2)); }
function providerOf(value) { return clean(value, 40).toLowerCase(); }
function asBody(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

async function dbJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  if (!response.ok) throw new Error(`supplier_optimizer_db_${response.status}_${raw.slice(0, 180)}`);
  return json;
}

function currentOffer(product) {
  const provider = providerOf(product.supplier || product.fulfillment_provider);
  if (!provider || !product.supplier_product_id || !product.supplier_sku_id) return null;
  return {
    id: null,
    source: 'current_product',
    product_id: product.id,
    provider,
    supplier_id: product.supplier_id || `${provider}:${product.supplier_product_id}`,
    supplier_url: product.supplier_url || null,
    supplier_product_id: product.supplier_product_id,
    supplier_sku_id: product.supplier_sku_id,
    supplier_sku_attr: product.supplier_sku_attr || null,
    variant_label: product.variant_label || null,
    product_price_ils: product.supplier_price_ils,
    shipping_price_ils: product.supplier_shipping,
    in_stock: product.supplier_in_stock,
    stock_quantity: product.supplier_stock,
    shipping_available: product.supplier_shipping_available,
    destination_country: 'IL',
    equivalence_verified: product.fulfillment_ready === true || Boolean(product.sku_verified_at || product.fulfillment_verified_at),
    equivalence_verified_at: product.sku_verified_at || product.fulfillment_verified_at || null,
    fulfillment_supported: AUTO_FULFILLMENT_PROVIDERS.has(provider),
    provider_snapshot: {
      fulfillment_provider: product.fulfillment_provider || provider,
      fulfillment_product_id: product.fulfillment_product_id || product.supplier_product_id,
      fulfillment_variant_id: product.fulfillment_variant_id || product.supplier_sku_id,
      fulfillment_sku: product.fulfillment_sku || null,
      fulfillment_origin_country: product.fulfillment_origin_country || product.supplier_ship_from_country || 'CN',
      fulfillment_logistic_name: product.fulfillment_logistic_name || null,
      fulfillment_provider_status: product.fulfillment_provider_status || null
    },
    last_sync_at: product.last_sync_at,
    shipping_last_checked_at: product.shipping_last_checked_at,
    sync_error: product.supplier_sync_error || product.shipping_sync_error || null
  };
}

function legacyAlternativeOffers(product) {
  return (Array.isArray(product.alternative_suppliers) ? product.alternative_suppliers : []).map((candidate) => {
    const provider = providerOf(candidate.supplier || 'aliexpress');
    return {
      id: null,
      source: 'legacy_alternative',
      product_id: product.id,
      provider,
      supplier_id: candidate.supplier_id || candidate.supplierId || `${provider}:${candidate.supplier_product_id || candidate.supplierProductId}`,
      supplier_url: candidate.supplier_url || candidate.supplierUrl || null,
      supplier_product_id: candidate.supplier_product_id || candidate.supplierProductId || null,
      supplier_sku_id: candidate.supplier_sku_id || candidate.supplierSkuId || null,
      supplier_sku_attr: candidate.supplier_sku_attr || candidate.supplierSkuAttr || null,
      variant_label: candidate.variant_label || candidate.variantLabel || null,
      product_price_ils: candidate.supplier_price_ils ?? candidate.supplierPriceIls,
      shipping_price_ils: candidate.supplier_shipping ?? candidate.supplierShipping,
      in_stock: candidate.in_stock,
      shipping_available: candidate.shipping_available,
      equivalence_verified: candidate.verified === true,
      equivalence_verified_at: candidate.verified_at || candidate.verifiedAt || null,
      fulfillment_supported: AUTO_FULFILLMENT_PROVIDERS.has(provider),
      provider_snapshot: candidate.provider_snapshot || {},
      last_sync_at: candidate.last_sync_at || candidate.lastSyncAt || null,
      shipping_last_checked_at: candidate.shipping_last_checked_at || candidate.shippingLastCheckedAt || null
    };
  });
}

function optimizerOptions(settings) {
  const policy = pricingPolicy();
  const ttlMinutes = Math.max(15, Math.min(1440, Number(settings.supplier_quote_ttl_minutes || 480)));
  return {
    ttlMs: ttlMinutes * 60 * 1000,
    enabledProviders: AUTO_FULFILLMENT_PROVIDERS,
    paymentFeePercent: Math.max(policy.processingFeeRate * 100, Number(settings.pricing_fee_percent || 0)),
    paymentFeeFixedIls: Math.max(policy.processingFeeFixedIls, Number(settings.pricing_fee_fixed_ils || 0)),
    reserveIls: Number(settings.pricing_reserve_ils || 0),
    taxReservePercent: Number(settings.pricing_tax_reserve_percent ?? DEFAULT_TAX_RESERVE_PERCENT),
    insuranceReservePercent: Number(settings.pricing_insurance_reserve_percent ?? DEFAULT_INSURANCE_RESERVE_PERCENT),
    vatRate: policy.vatRate,
    serviceFeePercent: policy.serviceFeeRate * 100,
    supplierBufferPercent: policy.supplierBufferRate * 100,
    advertisingCostIls: policy.advertisingCostIls,
    cancellationReserveIls: policy.cancellationRate * policy.refundFeeIls
  };
}

function minimumProfit(product, settings) {
  const configured = product.minimum_profit == null ? Number(settings.minimum_profit_ils) : Number(product.minimum_profit);
  return Math.max(DEFAULT_MINIMUM_PROFIT_ILS, Number.isFinite(configured) ? configured : DEFAULT_MINIMUM_PROFIT_ILS);
}

function evaluateProduct(product, storedOffers, settings) {
  const offers = [currentOffer(product), ...legacyAlternativeOffers(product), ...(storedOffers || [])].filter(Boolean);
  const options = optimizerOptions(settings);
  const selection = selectBestOffer(offers, options);
  const selected = selection.selected;
  const pricing = selected ? pricingForOffer(selected.offer, minimumProfit(product, settings), options) : null;
  return {
    productId: product.id,
    name: product.name,
    currentProvider: providerOf(product.supplier || product.fulfillment_provider),
    currentFulfillmentReady: product.fulfillment_ready === true,
    currentSellingPrice: numberOrNull(product.selling_price),
    currentLandedCost: product.supplier_price_ils == null || product.supplier_shipping == null
      ? null
      : numberOrNull(Number(product.supplier_price_ils) + Number(product.supplier_shipping)),
    minimumProfit: minimumProfit(product, settings),
    selectedOfferId: selected?.offer?.id || null,
    selectedProvider: selected?.normalized?.provider || null,
    selectedSupplierId: selected?.offer?.supplier_id || null,
    selectedLandedCost: selected?.normalized?.landedCost ?? null,
    pricing,
    selectedOffer: selected?.offer || null,
    offers: selection.evaluated.map((row) => ({
      id: row.offer.id || null,
      source: row.offer.source || 'supplier_offers',
      provider: row.normalized.provider,
      supplierId: row.offer.supplier_id || null,
      landedCost: row.normalized.landedCost,
      eligible: row.eligible,
      blockers: row.blockers
    }))
  };
}

function unchangedVerifiedCurrentOffer(result) {
  if (!result?.selectedOffer || result.selectedOffer.source !== 'current_product' || result.currentFulfillmentReady !== true) return false;
  if (result.currentProvider !== result.selectedProvider) return false;
  if (!Number.isFinite(Number(result.currentLandedCost)) || !Number.isFinite(Number(result.selectedLandedCost))) return false;
  if (!Number.isFinite(Number(result.currentSellingPrice)) || !Number.isFinite(Number(result.pricing?.sellingPrice))) return false;
  return Math.abs(Number(result.currentLandedCost) - Number(result.selectedLandedCost)) < 0.01 &&
    Math.abs(Number(result.currentSellingPrice) - Number(result.pricing.sellingPrice)) < 0.01;
}

function productPatch(result) {
  const offer = result.selectedOffer;
  const snapshot = offer.provider_snapshot && typeof offer.provider_snapshot === 'object' ? offer.provider_snapshot : {};
  const provider = providerOf(offer.provider || offer.supplier);
  const verifiedAt = offer.equivalence_verified_at || new Date().toISOString();
  const patch = {
    supplier: provider,
    supplier_id: offer.supplier_id,
    supplier_url: offer.supplier_url || null,
    supplier_product_id: offer.supplier_product_id,
    supplier_sku_id: offer.supplier_sku_id,
    supplier_sku_attr: offer.supplier_sku_attr || null,
    variant_label: offer.variant_label || null,
    supplier_price_ils: numberOrNull(offer.product_price_ils),
    supplier_shipping: numberOrNull(offer.shipping_price_ils),
    shipping_currency: 'ILS',
    supplier_in_stock: offer.in_stock === true,
    supplier_stock: offer.stock_quantity == null ? null : Number(offer.stock_quantity),
    supplier_shipping_available: offer.shipping_available === true,
    last_sync_at: offer.last_sync_at,
    shipping_last_checked_at: offer.shipping_last_checked_at,
    supplier_sync_error: null,
    shipping_sync_error: null,
    fulfillment_ready: true,
    selling_price: result.pricing.sellingPrice,
    selected_supplier_offer_id: offer.id || null,
    supplier_landed_cost_ils: result.selectedLandedCost,
    supplier_selected_at: new Date().toISOString(),
    supplier_selection_reason: 'lowest_verified_landed_cost_to_IL',
    updated_at: new Date().toISOString()
  };
  if (provider === 'aliexpress') {
    patch.sku_verified_at = verifiedAt;
    patch.sku_verified_by = 'supplier_optimizer';
    patch.fulfillment_provider = 'aliexpress';
    patch.fulfillment_product_id = offer.supplier_product_id;
    patch.fulfillment_variant_id = offer.supplier_sku_id;
    patch.fulfillment_sku = offer.supplier_sku_id;
    patch.fulfillment_origin_country = snapshot.fulfillment_origin_country || 'CN';
    patch.fulfillment_provider_status = 'verified_optimizer';
    patch.fulfillment_verified_at = verifiedAt;
  } else if (provider === 'cj') {
    patch.fulfillment_provider = 'cj';
    patch.fulfillment_product_id = snapshot.fulfillment_product_id || offer.supplier_product_id;
    patch.fulfillment_variant_id = snapshot.fulfillment_variant_id || offer.supplier_sku_id;
    patch.fulfillment_sku = snapshot.fulfillment_sku || offer.supplier_sku_id;
    patch.fulfillment_origin_country = snapshot.fulfillment_origin_country || 'CN';
    patch.fulfillment_logistic_name = snapshot.fulfillment_logistic_name || null;
    patch.fulfillment_provider_status = 'verified_optimizer';
    patch.fulfillment_provider_snapshot = snapshot;
    patch.fulfillment_verified_at = verifiedAt;
  }
  return patch;
}

function validateOfferInput(body) {
  const provider = providerOf(body.provider);
  if (!/^[a-z0-9_-]{2,40}$/.test(provider)) throw new Error('invalid_provider');
  const supplierId = clean(body.supplier_id, 160);
  const productId = clean(body.product_id, 80);
  const supplierProductId = clean(body.supplier_product_id, 200);
  const supplierSkuId = clean(body.supplier_sku_id, 200);
  if (!supplierId || !productId || !supplierProductId || !supplierSkuId) throw new Error('offer_identity_incomplete');
  return {
    product_id: productId,
    provider,
    supplier_id: supplierId,
    supplier_url: clean(body.supplier_url, 2000) || null,
    supplier_product_id: supplierProductId,
    supplier_sku_id: supplierSkuId,
    supplier_sku_attr: clean(body.supplier_sku_attr, 500) || null,
    variant_label: clean(body.variant_label, 300) || null,
    product_price_ils: numberOrNull(body.product_price_ils),
    shipping_price_ils: numberOrNull(body.shipping_price_ils),
    in_stock: body.in_stock === null ? null : body.in_stock === true,
    stock_quantity: body.stock_quantity == null ? null : Math.max(0, Math.floor(Number(body.stock_quantity))),
    shipping_available: body.shipping_available === null ? null : body.shipping_available === true,
    destination_country: 'IL',
    estimated_delivery_days: body.estimated_delivery_days == null ? null : Math.max(0, Math.floor(Number(body.estimated_delivery_days))),
    equivalence_verified: body.equivalence_verified === true,
    equivalence_verified_at: body.equivalence_verified === true ? (body.equivalence_verified_at || new Date().toISOString()) : null,
    fulfillment_supported: AUTO_FULFILLMENT_PROVIDERS.has(provider) && body.fulfillment_supported === true,
    provider_snapshot: body.provider_snapshot && typeof body.provider_snapshot === 'object' ? body.provider_snapshot : {},
    last_sync_at: body.last_sync_at || null,
    shipping_last_checked_at: body.shipping_last_checked_at || null,
    sync_error: clean(body.sync_error, 500) || null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const workerRun = Boolean(String(req.headers?.['x-cj-worker-token'] || '').trim());
  if (workerRun) {
    if (!await requireWorker(req, res)) return;
  } else if (!await requireAdmin(req, res)) return;
  try {
    const { supabaseUrl } = config();
    const settingsRows = await dbJson(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=*&limit=1`, { headers: dbHeaders() });
    const settings = settingsRows?.[0] || {};

    if (req.method === 'POST') {
      const body = asBody(req);
      if (body.action === 'offer_upsert') {
        const row = validateOfferInput(body.offer || body);
        const existing = await dbJson(`${supabaseUrl}/rest/v1/supplier_offers?product_id=eq.${encodeURIComponent(row.product_id)}&provider=eq.${encodeURIComponent(row.provider)}&supplier_id=eq.${encodeURIComponent(row.supplier_id)}&supplier_product_id=eq.${encodeURIComponent(row.supplier_product_id)}&supplier_sku_id=eq.${encodeURIComponent(row.supplier_sku_id)}&select=id&limit=1`, { headers: dbHeaders() });
        const url = existing?.[0]?.id ? `${supabaseUrl}/rest/v1/supplier_offers?id=eq.${existing[0].id}` : `${supabaseUrl}/rest/v1/supplier_offers`;
        const saved = await dbJson(url, { method: existing?.[0]?.id ? 'PATCH' : 'POST', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(row) });
        await audit('supplier_offer_upsert', 'product', row.product_id, { provider: row.provider, supplierId: row.supplier_id, verified: row.equivalence_verified });
        return res.status(200).json({ ok: true, offer: saved?.[0] || row });
      }
    }

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const [products, offers] = await Promise.all([
      dbJson(`${supabaseUrl}/rest/v1/products?select=*&active=eq.true&order=sort_order.asc`, { headers: dbHeaders() }),
      dbJson(`${supabaseUrl}/rest/v1/supplier_offers?destination_country=eq.IL&select=*&order=product_id.asc,updated_at.desc`, { headers: dbHeaders() })
    ]);
    const byProduct = new Map();
    for (const offer of offers || []) {
      const list = byProduct.get(String(offer.product_id)) || [];
      list.push(offer);
      byProduct.set(String(offer.product_id), list);
    }
    const results = (products || []).map((product) => evaluateProduct(product, byProduct.get(String(product.id)) || [], settings));

    const body = asBody(req);
    if ((!workerRun && req.method === 'GET') || body.action === 'preview') {
      return res.status(200).json({
        ok: true,
        applied: false,
        optimizerEnabled: settings.supplier_optimizer_enabled === true,
        minimumProfitFloorIls: DEFAULT_MINIMUM_PROFIT_ILS,
        products: results
      });
    }

    if (!workerRun && body.action !== 'apply') return res.status(400).json({ ok: false, error: 'unknown_action' });
    if (settings.supplier_optimizer_enabled !== true) return res.status(409).json({ ok: false, error: 'supplier_optimizer_disabled' });
    const applied = [], skipped = [];
    for (const result of results) {
      if (!result.selectedOffer || !result.pricing || result.pricing.projectedNetProfit + 0.001 < result.minimumProfit) {
        skipped.push({ productId: result.productId, reason: result.selectedOffer ? 'minimum_profit_not_met' : 'no_eligible_offer' });
        continue;
      }
      if (unchangedVerifiedCurrentOffer(result)) {
        skipped.push({ productId: result.productId, reason: 'current_verified_offer_unchanged' });
        continue;
      }
      const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(result.productId)}`, {
        method: 'PATCH', headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify(productPatch(result))
      });
      if (!response.ok) {
        skipped.push({ productId: result.productId, reason: `product_update_${response.status}` });
        continue;
      }
      applied.push({ productId: result.productId, provider: result.selectedProvider, landedCost: result.selectedLandedCost, sellingPrice: result.pricing.sellingPrice, projectedNetProfit: result.pricing.projectedNetProfit });
    }
    // Updating supplier identity can make the database clear fulfillment_ready as a
    // safety precaution. Restore it only after the complete, current CJ snapshot
    // passes the same stock, shipping, identity, freshness, cost and profit gates
    // used by the catalog worker.
    const refreshedProducts = await dbJson(`${supabaseUrl}/rest/v1/products?select=*&active=eq.true`, { headers: dbHeaders() });
    const reconciliationCandidates = (refreshedProducts || []).filter((product) => product.fulfillment_ready !== true && verifiedCjReadiness(product, settings));
    const reconciled = [];
    for (const product of reconciliationCandidates) {
      const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ fulfillment_ready: true, fulfillment_provider_status: 'verified_reconciled', updated_at: new Date().toISOString() })
      });
      if (response.ok) reconciled.push(String(product.id));
      else skipped.push({ productId: product.id, reason: `readiness_reconcile_${response.status}` });
    }
    await audit('supplier_optimizer_apply', 'site_settings', 'primary', { applied: applied.length, skipped: skipped.length, reconciled: reconciled.length });
    return res.status(200).json({ ok: true, applied: true, minimumProfitFloorIls: DEFAULT_MINIMUM_PROFIT_ILS, results: applied, skipped, reconciled });
  } catch (error) {
    console.error('supplier optimizer failed:', error.message);
    const code = clean(error.message || error, 220) || 'supplier_optimizer_failed';
    return res.status(code.includes('invalid_') || code.includes('incomplete') ? 400 : 500).json({ ok: false, error: code });
  }
};

module.exports.unchangedVerifiedCurrentOffer = unchangedVerifiedCurrentOffer;
