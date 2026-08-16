module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const supabaseUrl = (process.env.SUPABASE_URL || 'https://sapuzlieyxwlcjdzkzrb.supabase.co').replace(/\/$/, '');
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_u8IwJRz4KndmAk13fGZM5A_csTsqjsk';
    const headers = { apikey: publishableKey };

    const [productsResponse, settingsResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,old_price,currency,image_url,active,categories,kind,badge,badge_class,description,specs,sort_order,supplier_in_stock,supplier_shipping,supplier_shipping_available,shipping_currency,shipping_last_checked_at&active=eq.true&order=sort_order.asc`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=whatsapp_enabled,whatsapp_number,whatsapp_message,support_email,support_hours&limit=1`,
        { headers }
      )
    ]);

    if (!productsResponse.ok) {
      const details = await productsResponse.text();
      console.error('Supabase product catalog failed:', productsResponse.status, details);
      return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    }

    const rows = await productsResponse.json();
    const products = rows.map((row) => ({
      id: String(row.id),
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
      available: row.active === true && row.supplier_in_stock !== false && row.supplier_shipping_available !== false,
      shipping: row.supplier_shipping == null ? null : Number(row.supplier_shipping),
      shippingAvailable: row.supplier_shipping_available,
      shippingCurrency: row.shipping_currency || null,
      shippingCheckedAt: row.shipping_last_checked_at || null
    }));

    let store = {
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
          whatsappEnabled: row.whatsapp_enabled === true,
          whatsappNumber: row.whatsapp_number || null,
          whatsappMessage: row.whatsapp_message || store.whatsappMessage,
          supportEmail: row.support_email || null,
          supportHours: row.support_hours || null
        };
      }
    }

    return res.status(200).json({ ok: true, products, store });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
};
