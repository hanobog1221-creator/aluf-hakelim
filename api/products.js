const { apiKeyHeaders } = require('./_lib/supabase-server');
const { productAutomationStatus } = require('./_lib/product-readiness');

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

    const [productsResponse, settingsResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,old_price,currency,image_url,active,categories,kind,badge,badge_class,description,specs,sort_order,max_order_quantity,supplier,supplier_product_id,supplier_sku_id,supplier_sku_attr,supplier_in_stock,supplier_shipping_available,supplier_price_ils,supplier_shipping,fulfillment_ready,fulfillment_provider,fulfillment_product_id,fulfillment_variant_id,fulfillment_sku,fulfillment_provider_status,fulfillment_verified_at,last_sync_at,shipping_last_checked_at,supplier_sync_error,shipping_sync_error,minimum_profit,auto_fulfill_max_cost&active=eq.true&order=sort_order.asc`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled,whatsapp_enabled,whatsapp_number,whatsapp_message,support_email,support_hours,minimum_profit_ils,supplier_quote_ttl_minutes,pricing_fee_percent,pricing_fee_fixed_ils,pricing_reserve_ils,pricing_tax_reserve_percent,pricing_insurance_reserve_percent&limit=1`,
        { headers }
      )
    ]);

    if (!productsResponse.ok) {
      const details = await productsResponse.text();
      console.error('Supabase product catalog failed:', productsResponse.status, details.slice(0, 300));
      return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    }

    let store = {
      salesEnabled: false,
      whatsappEnabled: false,
      whatsappNumber: null,
      whatsappMessage: 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.',
      supportEmail: null,
      supportHours: null
    };

    let pricingSettings = {};
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

    const rows = await productsResponse.json();
    const products = rows.filter((row) => !REMOVED_CATALOG_IDS.has(String(row.id))).map((row) => {
      const id = String(row.id);
      const readinessRow = productAutomationStatus(row, pricingSettings);
      const fullReadiness = readinessRow.ready === true;
      const purchaseReady = row.active === true && fullReadiness;
      const storefrontVisible = purchaseReady;
      const outOfStock = row.supplier_in_stock === false;
      const stockStatus = outOfStock ? 'out_of_stock' : (purchaseReady ? 'available' : 'checking');
      const verifiedStatus = /^verified(?:_|$)/.test(String(row.fulfillment_provider_status || '').toLowerCase());
      const verifiedAt = row.fulfillment_verified_at || (verifiedStatus ? row.last_sync_at : null);
      const lastCheckedAt = row.last_sync_at || verifiedAt;
      const fresh = Boolean(lastCheckedAt && Date.now() - Date.parse(lastCheckedAt) <= 24 * 60 * 60 * 1000);
      const blockers = Array.isArray(readinessRow.blockers) ? readinessRow.blockers.map(String) : ['readiness_unknown'];
      const pricingBlockers = new Set([
        'supplier_product_id_missing','supplier_sku_id_missing','supplier_sku_not_verified','supplier_out_of_stock','supplier_stock_unknown',
        'supplier_shipping_unavailable','supplier_shipping_unknown','supplier_price_unknown','supplier_product_sync_stale','supplier_shipping_sync_stale',
        'supplier_sync_error','shipping_sync_error','minimum_profit_not_met','minimum_net_profit_not_met','supplier_cost_unknown_for_auto_limit','supplier_cost_above_auto_limit','readiness_unknown'
      ]);
      const pricingSafe = blockers.every((blocker) => !pricingBlockers.has(blocker));
      const priceBlockers = blockers.filter((blocker) => pricingBlockers.has(blocker));
      const priceVerified = Boolean(
        purchaseReady && row.supplier_in_stock === true && row.supplier_shipping_available === true &&
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
    }).filter((product) => product.purchaseReady === true);

    return res.status(200).json({ ok: true, products, store });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
};
