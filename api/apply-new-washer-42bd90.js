const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { supabaseUrl } = serverConfig();
  const now = new Date().toISOString();
  const update = {
    name: 'מכונת שטיפה אלחוטית Hippcron 21V – לחץ 65BAR',
    selling_price: 140,
    old_price: null,
    image_url: 'https://ae01.alicdn.com/kf/S38d445f9e43d4974a366c8e1cec265c8P.jpg',
    description: 'מכונת שטיפה אלחוטית וניידת Hippcron לניקוי רכב, חצר וגינה. לחץ מרבי מוצהר של 65BAR. הווריאנט שנבחר הוא גוף בלבד ללא סוללה וללא מטען.',
    kind: 'כלים חשמליים · שטיפה ותחזוקת רכב',
    badge: '65BAR',
    categories: ['power','car','maintenance'],
    specs: ['21V לפי היצרן','לחץ מרבי מוצהר 65BAR','גוף בלבד — ללא סוללה וללא מטען','ניידת ומתאימה לרכב, חצר וגינה','מלאי ומשלוח לישראל אומתו מול AliExpress'],
    supplier: 'aliexpress',
    supplier_url: 'https://www.aliexpress.com/item/1005012750681706.html',
    supplier_product_id: '1005012750681706',
    supplier_sku_id: '12000059236153340',
    variant_label: 'Without battery',
    supplier_price: 32.49,
    supplier_currency: 'USD',
    supplier_price_ils: 95.89,
    supplier_shipping: 5.87,
    shipping_currency: 'ILS',
    supplier_shipping_available: true,
    supplier_in_stock: true,
    supplier_stock: 11,
    last_sync_at: now,
    shipping_last_checked_at: now,
    sku_verified_at: now,
    sku_verified_by: 'aliexpress_ds_product_get',
    supplier_sync_error: null,
    shipping_sync_error: null,
    fulfillment_ready: true,
    updated_at: now
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.washer`, {
    method: 'PATCH',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(update)
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) return res.status(502).json({ ok: false, status: response.status });
  const row = rows[0] || {};
  return res.status(200).json({ ok: true, id: row.id, productId: row.supplier_product_id, skuId: row.supplier_sku_id, price: row.selling_price, image: row.image_url, ready: row.fulfillment_ready });
};
