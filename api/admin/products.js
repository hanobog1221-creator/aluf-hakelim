const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');

function cleanText(value, max, nullable = true) {
  if (value === null || value === undefined || value === '') return nullable ? null : '';
  const text = String(value).trim();
  if (text.length > max) throw new Error('text_too_long');
  return text;
}

function cleanNumber(value, nullable = false) {
  if (value === null || value === undefined || value === '') return nullable ? null : 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Error('invalid_number');
  return Number(n.toFixed(2));
}

function cleanCategories(value) {
  if (!Array.isArray(value) || value.length > 10) throw new Error('invalid_categories');
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
}

function cleanWhatsappNumber(value) {
  const text = cleanText(value, 30);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('invalid_whatsapp_number');
  return text;
}

function cleanCouponCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new Error('invalid_coupon_code');
  return code;
}

function cleanDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_date');
  return date.toISOString();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!await requireAdmin(req, res)) return;

  try {
    const { supabaseUrl } = config();

    if (req.method === 'GET') {
      const [productsResponse, settingsResponse, couponsResponse] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/products?select=*&order=sort_order.asc,created_at.asc`, { headers: dbHeaders() }),
        fetch(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=*&limit=1`, { headers: dbHeaders() }),
        fetch(`${supabaseUrl}/rest/v1/coupons?select=*&order=created_at.desc`, { headers: dbHeaders() })
      ]);
      if (!productsResponse.ok) throw new Error(`products_read_${productsResponse.status}`);
      if (!settingsResponse.ok) throw new Error(`settings_read_${settingsResponse.status}`);
      if (!couponsResponse.ok) throw new Error(`coupons_read_${couponsResponse.status}`);
      const products = await productsResponse.json();
      const settings = (await settingsResponse.json())[0] || null;
      const coupons = await couponsResponse.json();
      return res.status(200).json({ ok: true, products, settings, coupons });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      if (body.action === 'settings') {
        const row = {
          id: 'primary',
          whatsapp_enabled: body.whatsapp_enabled === true,
          whatsapp_number: cleanWhatsappNumber(body.whatsapp_number),
          whatsapp_message: cleanText(body.whatsapp_message, 500, false) || 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.',
          support_email: cleanText(body.support_email, 160),
          support_hours: cleanText(body.support_hours, 240),
          minimum_profit_ils: cleanNumber(body.minimum_profit_ils, true),
          updated_at: new Date().toISOString()
        };

        if (row.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.support_email)) {
          return res.status(400).json({ ok: false, error: 'invalid_support_email' });
        }
        if (row.whatsapp_enabled && !row.whatsapp_number) {
          return res.status(400).json({ ok: false, error: 'whatsapp_number_required' });
        }

        const response = await fetch(`${supabaseUrl}/rest/v1/site_settings?on_conflict=id`, {
          method: 'POST',
          headers: dbHeaders({
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation'
          }),
          body: JSON.stringify(row)
        });
        if (!response.ok) {
          const details = await response.text();
          throw new Error(`settings_save_${response.status}_${details.slice(0, 200)}`);
        }
        const settings = (await response.json())[0] || row;
        await audit('store_settings_update', 'site_settings', 'primary', {
          whatsapp_enabled: row.whatsapp_enabled,
          support_email_set: Boolean(row.support_email),
          minimum_profit_ils: row.minimum_profit_ils
        });
        return res.status(200).json({ ok: true, settings });
      }

      if (body.action === 'coupon_save') {
        const code = cleanCouponCode(body.code);
        const discountType = String(body.discount_type || 'percent');
        if (!['percent', 'fixed'].includes(discountType)) {
          return res.status(400).json({ ok: false, error: 'invalid_discount_type' });
        }
        const discountValue = cleanNumber(body.discount_value);
        if (discountValue <= 0 || (discountType === 'percent' && discountValue > 100)) {
          return res.status(400).json({ ok: false, error: 'invalid_discount_value' });
        }
        const usageLimit = body.usage_limit === null || body.usage_limit === undefined || body.usage_limit === ''
          ? null
          : Number(body.usage_limit);
        if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 1000000)) {
          return res.status(400).json({ ok: false, error: 'invalid_usage_limit' });
        }
        const startsAt = cleanDate(body.starts_at);
        const endsAt = cleanDate(body.ends_at);
        if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
          return res.status(400).json({ ok: false, error: 'invalid_coupon_dates' });
        }

        const row = {
          code,
          active: body.active !== false,
          discount_type: discountType,
          discount_value: discountValue,
          min_order: cleanNumber(body.min_order),
          max_discount: cleanNumber(body.max_discount, true),
          starts_at: startsAt,
          ends_at: endsAt,
          usage_limit: usageLimit,
          updated_at: new Date().toISOString()
        };
        const response = await fetch(`${supabaseUrl}/rest/v1/coupons?on_conflict=code`, {
          method: 'POST',
          headers: dbHeaders({
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation'
          }),
          body: JSON.stringify(row)
        });
        if (!response.ok) {
          const details = await response.text();
          throw new Error(`coupon_save_${response.status}_${details.slice(0, 200)}`);
        }
        const coupon = (await response.json())[0] || row;
        await audit('coupon_save', 'coupon', code, { active: row.active, discount_type: row.discount_type, discount_value: row.discount_value });
        return res.status(200).json({ ok: true, coupon });
      }

      const id = String(body.id || '').trim();
      const name = cleanText(body.name, 120, false);
      if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_product_id' });
      if (name.length < 2) return res.status(400).json({ ok: false, error: 'invalid_name' });

      const row = {
        id,
        name,
        selling_price: cleanNumber(body.selling_price),
        old_price: cleanNumber(body.old_price, true),
        currency: 'ILS',
        active: body.active !== false,
        image_url: cleanText(body.image_url, 2000),
        description: cleanText(body.description, 1200),
        badge: cleanText(body.badge, 100),
        badge_class: '',
        kind: cleanText(body.kind, 200),
        categories: cleanCategories(Array.isArray(body.categories) ? body.categories : []),
        specs: [],
        sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        supplier: 'aliexpress',
        supplier_url: cleanText(body.supplier_url, 2000),
        supplier_product_id: cleanText(body.supplier_product_id, 100),
        supplier_sku_id: cleanText(body.supplier_sku_id, 100),
        variant_label: cleanText(body.variant_label, 200),
        fulfillment_ready: false,
        last_sync_at: null,
        updated_at: new Date().toISOString()
      };

      const response = await fetch(`${supabaseUrl}/rest/v1/products`, {
        method: 'POST',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!response.ok) {
        const details = await response.text();
        if (response.status === 409) return res.status(409).json({ ok: false, error: 'product_exists' });
        throw new Error(`product_create_${response.status}_${details.slice(0, 200)}`);
      }
      const product = (await response.json())[0] || null;
      await audit('product_create', 'product', id, {});
      return res.status(201).json({ ok: true, product });
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = String(body.id || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_product_id' });

      const existingResponse = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: dbHeaders() });
      if (!existingResponse.ok) throw new Error(`product_read_${existingResponse.status}`);
      const existing = (await existingResponse.json())[0];
      if (!existing) return res.status(404).json({ ok: false, error: 'product_not_found' });

      const update = {};
      if ('name' in body) {
        const nextName = cleanText(body.name, 120, false);
        if (nextName.length < 2) return res.status(400).json({ ok: false, error: 'invalid_name' });
        update.name = nextName;
      }
      if ('selling_price' in body) update.selling_price = cleanNumber(body.selling_price);
      if ('old_price' in body) update.old_price = cleanNumber(body.old_price, true);
      if ('active' in body) update.active = Boolean(body.active);
      if ('image_url' in body) update.image_url = cleanText(body.image_url, 2000);
      if ('description' in body) update.description = cleanText(body.description, 1200);
      if ('badge' in body) update.badge = cleanText(body.badge, 100);
      if ('kind' in body) update.kind = cleanText(body.kind, 200);
      if ('supplier_url' in body) update.supplier_url = cleanText(body.supplier_url, 2000);
      if ('supplier_product_id' in body) update.supplier_product_id = cleanText(body.supplier_product_id, 100);
      if ('supplier_sku_id' in body) update.supplier_sku_id = cleanText(body.supplier_sku_id, 100);
      if ('variant_label' in body) update.variant_label = cleanText(body.variant_label, 200);
      if ('sort_order' in body) {
        const sort = Number(body.sort_order);
        if (!Number.isInteger(sort) || sort < -10000 || sort > 10000) return res.status(400).json({ ok: false, error: 'invalid_sort_order' });
        update.sort_order = sort;
      }
      if ('categories' in body) update.categories = cleanCategories(body.categories);

      const supplierChanged = ['supplier_url','supplier_product_id','supplier_sku_id','variant_label'].some((key) => key in update && update[key] !== existing[key]);
      if (supplierChanged) {
        update.fulfillment_ready = false;
        update.last_sync_at = null;
      }
      update.updated_at = new Date().toISOString();

      const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(update)
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`product_update_${response.status}_${details.slice(0, 200)}`);
      }
      const product = (await response.json())[0] || null;
      await audit('product_update', 'product', id, { fields: Object.keys(update) });
      return res.status(200).json({ ok: true, product });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('admin products error', error);
    const message = String(error.message || error);
    if (message.includes('invalid_whatsapp_number')) return res.status(400).json({ ok: false, error: 'invalid_whatsapp_number' });
    if (message.includes('invalid_coupon_code')) return res.status(400).json({ ok: false, error: 'invalid_coupon_code' });
    if (message.includes('invalid_date')) return res.status(400).json({ ok: false, error: 'invalid_date' });
    return res.status(500).json({ ok: false, error: 'admin_products_failed' });
  }
};
