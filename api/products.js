const { apiKeyHeaders } = require('./_lib/supabase-server');

const RETAINED_CATALOG_IDS = new Set([
  'socket',
  'ratchet',
  'impact',
  'washer',
  'ae-1005012832500138',
  'ae-1005007178140659',
  'ae-1005009577109019',
  'ae-1005009926657110'
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

    const [productsResponse, readinessResponse, settingsResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,old_price,currency,image_url,active,categories,kind,badge,badge_class,description,specs,sort_order,max_order_quantity,supplier_in_stock,supplier_shipping_available&or=(active.eq.true,id.in.(${[...RETAINED_CATALOG_IDS].join(',')}))&order=sort_order.asc`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/product_fulfillment_readiness?select=id,ready_for_paid_order`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled,whatsapp_enabled,whatsapp_number,whatsapp_message,support_email,support_hours&limit=1`,
        { headers }
      )
    ]);

    if (!productsResponse.ok || !readinessResponse.ok) {
      const details = !productsResponse.ok ? await productsResponse.text() : await readinessResponse.text();
      console.error('Supabase product catalog/readiness failed:', !productsResponse.ok ? productsResponse.status : readinessResponse.status, details.slice(0, 300));
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

    if (settingsResponse.ok) {
      const settingsRows = await settingsResponse.json();
      const row = settingsRows[0];
      if (row) {
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
    const readiness = new Map(readinessRows.map((row) => [String(row.id), row.ready_for_paid_order === true]));
    const rows = await productsResponse.json();
    const products = rows.filter((row) => !REMOVED_CATALOG_IDS.has(String(row.id))).map((row) => {
      const id = String(row.id);
      const fullReadiness = readiness.get(id) === true;
      const purchaseReady = row.active === true && fullReadiness;
      const storefrontVisible = row.active === true || RETAINED_CATALOG_IDS.has(id);
      const outOfStock = row.supplier_in_stock === false;
      const stockStatus = outOfStock ? 'out_of_stock' : (purchaseReady ? 'available' : 'checking');

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
        shippingAvailable: row.supplier_shipping_available == null ? null : row.supplier_shipping_available === true
      };
    });

    return res.status(200).json({ ok: true, products, store });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
};
