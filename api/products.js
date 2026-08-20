const { apiKeyHeaders } = require('./_lib/supabase-server');
const { pricingPolicy } = require('./_lib/pricing-engine');
const { DEFAULT_MINIMUM_PROFIT_ILS, DEFAULT_TAX_RESERVE_PERCENT, DEFAULT_INSURANCE_RESERVE_PERCENT, pricingForOffer } = require('./_lib/supplier-optimizer');

const RETAINED_CATALOG_IDS = new Set([
  'socket',
  'ratchet',
  'impact',
  'washer',
  'ae-1005012832500138',
  'ae-1005007178140659',
  'ae-1005009577109019',
  'ae-1005009926657110',
  'cj-detail-brush',
  'cj-car-mop',
  'cj-magnetic-ring',
  'cj-k5-bits',
  'cj-microfiber-towel',
  'cj-wash-mitt',
  'cj-silicone-squeegee',
  'cj-tire-gauge',
  'cj-phone-holder',
  'cj-kw310-obd'
]);
const REMOVED_CATALOG_IDS = new Set(['battery588']);

function liveCostPricingAudit(row, settings) {
  if (!settings || row.supplier_price_ils == null || row.supplier_shipping == null) return { safe: false, recommendedPrice: null };
  try {
    const policy = pricingPolicy();
    const configuredMinimum = row.minimum_profit == null ? Number(settings.minimum_profit_ils) : Number(row.minimum_profit);
    const minimumProfit = Math.max(DEFAULT_MINIMUM_PROFIT_ILS, Number.isFinite(configuredMinimum) ? configuredMinimum : DEFAULT_MINIMUM_PROFIT_ILS);
    const pricing = pricingForOffer(row, minimumProfit, {
      paymentFeePercent: Math.max(policy.processingFeeRate * 100, Number(settings.pricing_fee_percent || 0)),
      paymentFeeFixedIls: Number(settings.pricing_fee_fixed_ils || 0),
      reserveIls: Number(settings.pricing_reserve_ils || 0),
      taxReservePercent: Number(settings.pricing_tax_reserve_percent ?? DEFAULT_TAX_RESERVE_PERCENT),
      insuranceReservePercent: Number(settings.pricing_insurance_reserve_percent ?? DEFAULT_INSURANCE_RESERVE_PERCENT),
      vatRate: policy.vatRate,
      serviceFeePercent: policy.serviceFeeRate * 100,
      supplierBufferPercent: policy.supplierBufferRate * 100,
      advertisingCostIls: policy.advertisingCostIls,
      cancellationReserveIls: policy.cancellationRate * policy.refundFeeIls
    });
    return {
      safe: Number.isFinite(Number(row.selling_price)) && Number(row.selling_price) + 0.001 >= pricing.sellingPrice,
      recommendedPrice: pricing.sellingPrice
    };
  } catch {
    return { safe: false, recommendedPrice: null };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const configuredKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !configuredKey) {
      console.error('Public catalog Supabase credentials are missing');
      return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    }
    const headers = apiKeyHeaders({}, configuredKey);

    const [productsResponse, readinessResponse, settingsResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,old_price,currency,image_url,active,categories,kind,badge,badge_class,description,specs,sort_order,max_order_quantity,supplier_price_ils,supplier_shipping,minimum_profit,supplier_in_stock,supplier_shipping_available,fulfillment_provider_status,fulfillment_verified_at,last_sync_at,supplier_sync_error,shipping_sync_error&or=(active.eq.true,id.in.(${[...RETAINED_CATALOG_IDS].join(',')}))&order=sort_order.asc`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/product_fulfillment_readiness?select=id,ready_for_paid_order,blockers`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled,whatsapp_enabled,whatsapp_number,whatsapp_message,support_email,support_hours,minimum_profit_ils,pricing_fee_percent,pricing_fee_fixed_ils,pricing_reserve_ils,pricing_tax_reserve_percent,pricing_insurance_reserve_percent&limit=1`,
        { headers }
      )
    ]);

    if (!productsResponse.ok || !readinessResponse.ok) {
      const details = !productsResponse.ok ? await productsResponse.text() : await readinessResponse.text();
      console.error('Supabase product catalog/readiness failed:', !productsResponse.ok ? productsResponse.status : readinessResponse.status, details.slice(0, 300));
      return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    }

    let pricingSettings = null;
    let store = {
      salesEnabled: false,
      whatsappEnabled: false,
      whatsappNumber: null,
      whatsappMessage: 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.',
      supportEmail: null,
      supportHours: null
    };

    if (settingsResponse.ok) {
      const settingsRows = await settingsResponse.json();
      const row = settingsRows[0];
      if (row) {
        pricingSettings = row;
        store = {
          salesEnabled: row.sales_enabled === true,
          whatsappEnabled: row.whatsapp_enabled === true,
          whatsappNumber: row.whatsapp_number || null,
          whatsappMessage: row.whatsapp_message || store.whatsappMessage,
          supportEmail: row.support_email || null,
          supportHours: row.support_hours || null
        };
      }
    } else {
      console.error('Public store settings read failed:', settingsResponse.status, (await settingsResponse.text()).slice(0, 300));
    }

    const readinessRows = await readinessResponse.json();
    const readiness = new Map(readinessRows.map((row) => [String(row.id), row]));
    const rows = await productsResponse.json();
    const products = rows.filter((row) => !REMOVED_CATALOG_IDS.has(String(row.id))).map((row) => {
      const id = String(row.id);
      const readinessRow = readiness.get(id) || {};
      const fullReadiness = readinessRow.ready_for_paid_order === true;
      const storefrontVisible = row.active === true || RETAINED_CATALOG_IDS.has(id);
      const outOfStock = row.supplier_in_stock === false;
      const verifiedStatus = /^verified(?:_|$)/.test(String(row.fulfillment_provider_status || '').toLowerCase());
      const verifiedAt = row.fulfillment_verified_at || (verifiedStatus ? row.last_sync_at : null);
      const lastCheckedAt = row.last_sync_at || verifiedAt;
      const fresh = Boolean(lastCheckedAt && Date.now() - Date.parse(lastCheckedAt) <= 24 * 60 * 60 * 1000);
      const blockers = Array.isArray(readinessRow.blockers) ? readinessRow.blockers.map(String) : ['readiness_unknown'];
      const profitBlockers = new Set(['minimum_profit_not_met', 'minimum_net_profit_not_met']);
      const livePricing = liveCostPricingAudit(row, pricingSettings);
      const noUnresolvedReadinessBlockers = blockers.every((blocker) => profitBlockers.has(blocker));
      const purchaseReady = row.active === true && livePricing.safe && (fullReadiness || noUnresolvedReadinessBlockers);
      const stockStatus = outOfStock ? 'out_of_stock' : (purchaseReady ? 'available' : 'checking');
      const pricingBlockers = new Set([
        'supplier_product_id_missing','supplier_sku_id_missing','supplier_sku_not_verified','supplier_out_of_stock','supplier_stock_unknown',
        'supplier_shipping_unavailable','supplier_shipping_unknown','supplier_price_unknown','supplier_product_sync_stale','supplier_shipping_sync_stale',
        'supplier_sync_error','shipping_sync_error','minimum_profit_not_met','minimum_net_profit_not_met','supplier_cost_unknown_for_auto_limit','supplier_cost_above_auto_limit','readiness_unknown'
      ]);
      const pricingSafe = livePricing.safe && blockers.every((blocker) => profitBlockers.has(blocker) || !pricingBlockers.has(blocker));
      const priceBlockers = blockers.filter((blocker) => pricingBlockers.has(blocker) && !(profitBlockers.has(blocker) && livePricing.safe));
      const priceVerified = Boolean(
        row.active === true && verifiedStatus && verifiedAt && fresh && row.supplier_in_stock === true && row.supplier_shipping_available === true &&
        !row.supplier_sync_error && !row.shipping_sync_error && pricingSafe && Number.isFinite(Number(row.selling_price)) && Number(row.selling_price) > 0
      );

      return {
        id,
        name: String(row.name),
        price: Number(row.selling_price),
        old: row.old_price == null ? null : Number(row.old_price),
        currency: row.currency || 'ILS',
        img: row.image_url || null,
        cat: Array.isArray(row.categories) ? row.categories : [],
        kind: row.kind || '',
        badge: row.badge || '',
        badgeClass: row.badge_class || '',
        desc: row.description || '',
        specs: Array.isArray(row.specs) ? row.specs : [],
        maxQty: Math.max(1, Math.min(20, Number(row.max_order_quantity || 20))),
        available: storefrontVisible,
        purchaseReady,
        inStock: row.supplier_in_stock == null ? null : row.supplier_in_stock === true,
        stockStatus,
        shippingAvailable: row.supplier_shipping_available == null ? null : row.supplier_shipping_available === true,
        priceVerified,
        priceBlockers,
        verificationStatus: row.fulfillment_provider_status || 'not_started',
        verificationFailed: Boolean(row.supplier_sync_error || row.shipping_sync_error),
        lastCheckedAt
      };
    });

    return res.status(200).json({ ok: true, products, store });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
};
