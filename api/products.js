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

    const response = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,currency,image_url,active&active=eq.true&order=created_at.asc`,
      {
        headers: {
          apikey: publishableKey
        }
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error('Supabase product catalog failed:', response.status, details);
      return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
    }

    const rows = await response.json();
    const products = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      price: Number(row.selling_price),
      currency: row.currency || 'ILS',
      image: row.image_url || null,
      available: row.active === true
    }));

    return res.status(200).json({ ok: true, products });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(500).json({ ok: false, error: 'catalog_unavailable' });
  }
};
