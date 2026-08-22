const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { pricingPolicy, quoteProductPrice, autoPriceUpdate } = require('../pricing-engine');

function withPricingQuote(product) {
  return {
    ...product,
    pricing_quote: quoteProductPrice({
      supplierPriceIls: product?.supplier_price_ils,
      supplierShippingIls: product?.supplier_shipping
    })
  };
}

const SUPPLIER_HOSTS = {
  aliexpress: ['aliexpress.com'],
  cj: ['cjdropshipping.com'],
  alibaba: ['alibaba.com'],
  banggood: ['banggood.com'],
  hypersku: ['hypersku.com'],
  eprolo: ['eprolo.com'],
  wiio: ['wiio.io', 'wiio.com']
};

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

function cleanQuantityLimit(value, fallback = 20) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('invalid_quantity_limit');
  return n;
}

function cleanIntegerRange(value, min, max, fallback, errorCode) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(errorCode);
  return n;
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

function cleanBusinessType(value) {
  if (value === null || value === undefined || value === '') return null;
  const type = String(value).trim();
  if (!['exempt','authorized','company','other'].includes(type)) throw new Error('invalid_business_type');
  return type;
}

function cleanTaxId(value) {
  const text = cleanText(value, 30);
  if (!text) return null;
  const compact = text.replace(/[\s-]/g, '');
  if (!/^[A-Za-z0-9]{5,20}$/.test(compact)) throw new Error('invalid_tax_id');
  return text;
}

function cleanSupplierProductId(value) {
  const text = cleanText(value, 200);
  if (!text) return null;
  if (!/^[A-Za-z0-9:_-]{2,200}$/.test(text)) throw new Error('invalid_supplier_product_id');
  return text;
}

function cleanPercent(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 100) throw new Error('invalid_percentage');
  return Number(n.toFixed(4));
}

function cleanSupplier(value) {
  const supplier = String(value || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SUPPLIER_HOSTS, supplier)) throw new Error('invalid_supplier');
  return supplier;
}

function cleanSupplierUrl(value, supplier = 'aliexpress') {
  const text = cleanText(value, 2000);
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new Error('invalid_supplier_url'); }
  const host = url.hostname.toLowerCase();
  const allowed = SUPPLIER_HOSTS[cleanSupplier(supplier)] || [];
  if (url.protocol !== 'https:' || !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('invalid_supplier_url');
  }
  return text;
}

function cleanSupplierId(value) {
  const id = cleanText(value, 160);
  if (!id) return null;
  if (!/^[A-Za-z0-9:_-]{2,160}$/.test(id)) throw new Error('invalid_supplier_id');
  return id;
}

function cleanAlternativeSuppliers(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('invalid_alternative_suppliers');
  const seen = new Set();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('invalid_alternative_suppliers');
    const supplierId = cleanSupplierId(candidate.supplier_id);
    if (!supplierId || seen.has(supplierId)) throw new Error('invalid_alternative_suppliers');
    seen.add(supplierId);
    const supplier = cleanSupplier(candidate.supplier || 'aliexpress');
    const row = {
      supplier_id: supplierId,
      supplier,
      supplier_url: cleanSupplierUrl(candidate.supplier_url, supplier),
      supplier_product_id: cleanSupplierProductId(candidate.supplier_product_id),
      supplier_sku_id: cleanText(candidate.supplier_sku_id, 100),
      variant_label: cleanText(candidate.variant_label, 200),
      verified: candidate.verified === true,
      in_stock: candidate.in_stock === null ? null : Boolean(candidate.in_stock),
      shipping_available: candidate.shipping_available === null ? null : Boolean(candidate.shipping_available),
      supplier_price_ils: cleanNumber(candidate.supplier_price_ils, true),
      supplier_shipping: cleanNumber(candidate.supplier_shipping, true),
      last_sync_at: cleanDate(candidate.last_sync_at),
      shipping_last_checked_at: cleanDate(candidate.shipping_last_checked_at)
    };
    if (row.verified && (!row.supplier_product_id || !row.supplier_sku_id || !row.last_sync_at || !row.shipping_last_checked_at)) {
      throw new Error('unverifiable_alternative_supplier');
    }
    return row;
  });
}

function cleanImageUrl(value) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  let url;
  try { url = new URL(text); } catch { throw new Error('invalid_image_url'); }
  if (url.protocol !== 'https:') throw new Error('invalid_image_url');
  return text;
}

function cleanCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('invalid_currency');
  return code;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
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
      return res.status(200).json({
        ok: true,
        products: products.map(withPricingQuote),
        settings,
        coupons,
        pricingPolicy: pricingPolicy()
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      if (body.action === 'settings') {
        const currentResponse = await fetch(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=*&limit=1`, { headers: dbHeaders() });
        if (!currentResponse.ok) throw new Error(`settings_read_${currentResponse.status}`);
        const current = (await currentResponse.json())[0] || {};

        const row = {
          id: 'primary',
          sales_enabled: hasOwn(body, 'sales_enabled') ? body.sales_enabled === true : current.sales_enabled === true,
          whatsapp_enabled: hasOwn(body, 'whatsapp_enabled') ? body.whatsapp_enabled === true : current.whatsapp_enabled === true,
          whatsapp_number: hasOwn(body, 'whatsapp_number') ? cleanWhatsappNumber(body.whatsapp_number) : (current.whatsapp_number || null),
          whatsapp_message: hasOwn(body, 'whatsapp_message')
            ? (cleanText(body.whatsapp_message, 500, false) || 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.')
            : (current.whatsapp_message || 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.'),
          support_email: hasOwn(body, 'support_email') ? cleanText(body.support_email, 160) : (current.support_email || null),
          support_hours: hasOwn(body, 'support_hours') ? cleanText(body.support_hours, 240) : (current.support_hours || null),
          minimum_profit_ils: hasOwn(body, 'minimum_profit_ils') ? Math.max(10, cleanNumber(body.minimum_profit_ils, true) ?? 10) : Math.max(10, Number(current.minimum_profit_ils ?? 10)),
          supplier_optimizer_enabled: hasOwn(body, 'supplier_optimizer_enabled') ? body.supplier_optimizer_enabled === true : current.supplier_optimizer_enabled === true,
          supplier_quote_ttl_minutes: hasOwn(body, 'supplier_quote_ttl_minutes')
            ? cleanIntegerRange(body.supplier_quote_ttl_minutes, 15, 1440, 480, 'invalid_supplier_quote_ttl')
            : cleanIntegerRange(current.supplier_quote_ttl_minutes, 15, 1440, 480, 'invalid_supplier_quote_ttl'),
          pricing_fee_percent: Math.max(pricingPolicy().processingFeeRate * 100, hasOwn(body, 'pricing_fee_percent') ? cleanPercent(body.pricing_fee_percent) : cleanPercent(current.pricing_fee_percent, 0)),
          pricing_fee_fixed_ils: Math.max(pricingPolicy().processingFeeFixedIls, hasOwn(body, 'pricing_fee_fixed_ils') ? cleanNumber(body.pricing_fee_fixed_ils) : Number(current.pricing_fee_fixed_ils || 0)),
          pricing_reserve_ils: 0,
          pricing_tax_reserve_percent: 0,
          pricing_insurance_reserve_percent: 0,
          payment_quote_ttl_minutes: hasOwn(body, 'payment_quote_ttl_minutes')
            ? cleanIntegerRange(body.payment_quote_ttl_minutes, 5, 180, 30, 'invalid_payment_quote_ttl')
            : cleanIntegerRange(current.payment_quote_ttl_minutes, 5, 180, 30, 'invalid_payment_quote_ttl'),
          business_legal_name: hasOwn(body, 'business_legal_name') ? cleanText(body.business_legal_name, 160) : (current.business_legal_name || null),
          business_tax_id: hasOwn(body, 'business_tax_id') ? cleanTaxId(body.business_tax_id) : (current.business_tax_id || null),
          business_type: hasOwn(body, 'business_type') ? cleanBusinessType(body.business_type) : (current.business_type || null),
          business_address: hasOwn(body, 'business_address') ? cleanText(body.business_address, 300) : (current.business_address || null),
          business_phone: hasOwn(body, 'business_phone') ? cleanText(body.business_phone, 40) : (current.business_phone || null),
          updated_at: new Date().toISOString()
        };

        if (row.pricing_tax_reserve_percent + row.pricing_insurance_reserve_percent >= 100) {
          return res.status(400).json({ ok: false, error: 'invalid_net_reserve_percentage' });
        }

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
          fields: Object.keys(body).filter((key) => key !== 'action'),
          sales_enabled: row.sales_enabled,
          whatsapp_enabled: row.whatsapp_enabled,
          support_email_set: Boolean(row.support_email),
          minimum_profit_ils: row.minimum_profit_ils,
          supplier_optimizer_enabled: row.supplier_optimizer_enabled,
          payment_quote_ttl_minutes: row.payment_quote_ttl_minutes,
          business_details_set: Boolean(row.business_legal_name && row.business_tax_id && row.business_type)
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

      const supplier = cleanSupplier(body.supplier || 'aliexpress');
      const row = {
        id,
        name,
        selling_price: cleanNumber(body.selling_price),
        old_price: cleanNumber(body.old_price, true),
        currency: 'ILS',
        active: body.active !== false,
        image_url: cleanImageUrl(body.image_url),
        description: cleanText(body.description, 1200),
        badge: cleanText(body.badge, 100),
        badge_class: '',
        kind: cleanText(body.kind, 200),
        categories: cleanCategories(Array.isArray(body.categories) ? body.categories : []),
        specs: [],
        sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        max_order_quantity: cleanQuantityLimit(body.max_order_quantity, 20),
        supplier,
        supplier_id: cleanSupplierId(body.supplier_id),
        supplier_url: cleanSupplierUrl(body.supplier_url, supplier),
        supplier_product_id: cleanSupplierProductId(body.supplier_product_id),
        supplier_sku_id: cleanText(body.supplier_sku_id, 100),
        variant_label: cleanText(body.variant_label, 200),
        alternative_suppliers: cleanAlternativeSuppliers(Array.isArray(body.alternative_suppliers) ? body.alternative_suppliers : []),
        minimum_profit: body.minimum_profit == null ? null : Math.max(10, cleanNumber(body.minimum_profit, true) ?? 10),
        auto_fulfill_max_cost: cleanNumber(body.auto_fulfill_max_cost, true),
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
      return res.status(201).json({ ok: true, product: product ? withPricingQuote(product) : null });
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
      if ('image_url' in body) update.image_url = cleanImageUrl(body.image_url);
      if ('description' in body) update.description = cleanText(body.description, 1200);
      if ('badge' in body) update.badge = cleanText(body.badge, 100);
      if ('kind' in body) update.kind = cleanText(body.kind, 200);
      const nextSupplier = 'supplier' in body ? cleanSupplier(body.supplier) : cleanSupplier(existing.supplier || 'aliexpress');
      if ('supplier' in body) update.supplier = nextSupplier;
      if ('supplier_url' in body) update.supplier_url = cleanSupplierUrl(body.supplier_url, nextSupplier);
      if ('supplier_id' in body) update.supplier_id = cleanSupplierId(body.supplier_id);
      if ('supplier_product_id' in body) update.supplier_product_id = cleanSupplierProductId(body.supplier_product_id);
      if ('supplier_sku_id' in body) update.supplier_sku_id = cleanText(body.supplier_sku_id, 100);
      if ('variant_label' in body) update.variant_label = cleanText(body.variant_label, 200);
      if ('alternative_suppliers' in body) update.alternative_suppliers = cleanAlternativeSuppliers(body.alternative_suppliers);
      if ('supplier_price' in body) update.supplier_price = cleanNumber(body.supplier_price, true);
      if ('supplier_currency' in body) update.supplier_currency = cleanCurrency(body.supplier_currency);
      if ('supplier_price_ils' in body) update.supplier_price_ils = cleanNumber(body.supplier_price_ils, true);
      if ('supplier_shipping' in body) {
        update.supplier_shipping = cleanNumber(body.supplier_shipping, true);
        if (update.supplier_shipping !== null) update.shipping_currency = 'ILS';
      }
      if ('supplier_shipping_available' in body) {
        update.supplier_shipping_available = body.supplier_shipping_available === null ? null : Boolean(body.supplier_shipping_available);
      }
      if ('supplier_in_stock' in body) {
        update.supplier_in_stock = body.supplier_in_stock === null ? null : Boolean(body.supplier_in_stock);
      }
      if ('minimum_profit' in body) update.minimum_profit = body.minimum_profit == null ? null : Math.max(10, cleanNumber(body.minimum_profit, true) ?? 10);
      if ('auto_fulfill_max_cost' in body) update.auto_fulfill_max_cost = cleanNumber(body.auto_fulfill_max_cost, true);
      if ('max_order_quantity' in body) update.max_order_quantity = cleanQuantityLimit(body.max_order_quantity, existing.max_order_quantity || 20);
      if ('sort_order' in body) {
        const sort = Number(body.sort_order);
        if (!Number.isInteger(sort) || sort < -10000 || sort > 10000) return res.status(400).json({ ok: false, error: 'invalid_sort_order' });
        update.sort_order = sort;
      }
      if ('categories' in body) update.categories = cleanCategories(body.categories);

      const publicCaptureAt = 'public_capture_at' in body ? cleanDate(body.public_capture_at) : null;
      const supplierChanged = ['supplier','supplier_id','supplier_url','supplier_product_id','supplier_sku_id','variant_label','alternative_suppliers'].some((key) => key in update && JSON.stringify(update[key]) !== JSON.stringify(existing[key]));
      if (supplierChanged) {
        update.fulfillment_ready = false;
        if (!publicCaptureAt) update.last_sync_at = null;
      }
      if (publicCaptureAt) {
        const hasPublicPrice = ['supplier_price','supplier_currency','supplier_price_ils'].some((key) => key in update);
        const hasPublicShipping = ['supplier_shipping','supplier_shipping_available'].some((key) => key in update);
        if (hasPublicPrice) update.last_sync_at = publicCaptureAt;
        if (hasPublicShipping) update.shipping_last_checked_at = publicCaptureAt;
        update.fulfillment_ready = false;
      }
      const supplierCostChanged = ['supplier_price_ils','supplier_shipping','supplier_shipping_available'].some((key) => key in update);
      if (supplierCostChanged) {
        const effective = { ...existing, ...update };
        const pricing = autoPriceUpdate(effective);
        Object.assign(update, pricing.update);
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
      await audit(body.source === 'aliexpress_public_page' ? 'supplier_public_page_import' : 'product_update', 'product', id, {
        fields: Object.keys(update),
        source: body.source === 'aliexpress_public_page' ? 'aliexpress_public_page' : null
      });
      return res.status(200).json({ ok: true, product: product ? withPricingQuote(product) : null });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('admin products error', error);
    const message = String(error.message || error);
    if (message.includes('invalid_whatsapp_number')) return res.status(400).json({ ok: false, error: 'invalid_whatsapp_number' });
    if (message.includes('invalid_coupon_code')) return res.status(400).json({ ok: false, error: 'invalid_coupon_code' });
    if (message.includes('invalid_date')) return res.status(400).json({ ok: false, error: 'invalid_date' });
    if (message.includes('invalid_business_type')) return res.status(400).json({ ok: false, error: 'invalid_business_type' });
    if (message.includes('invalid_tax_id')) return res.status(400).json({ ok: false, error: 'invalid_tax_id' });
    if (message.includes('invalid_quantity_limit')) return res.status(400).json({ ok: false, error: 'invalid_quantity_limit' });
    if (message.includes('invalid_supplier_id')) return res.status(400).json({ ok: false, error: 'invalid_supplier_id' });
    if (message.includes('invalid_alternative_suppliers')) return res.status(400).json({ ok: false, error: 'invalid_alternative_suppliers' });
    if (message.includes('unverifiable_alternative_supplier')) return res.status(400).json({ ok: false, error: 'unverifiable_alternative_supplier' });
    if (message.includes('invalid_payment_quote_ttl')) return res.status(400).json({ ok: false, error: 'invalid_payment_quote_ttl' });
    if (message.includes('invalid_supplier_quote_ttl')) return res.status(400).json({ ok: false, error: 'invalid_supplier_quote_ttl' });
    if (message.includes('invalid_number')) return res.status(400).json({ ok: false, error: 'invalid_number' });
    if (message.includes('invalid_percentage')) return res.status(400).json({ ok: false, error: 'invalid_percentage' });
    if (message.includes('invalid_currency')) return res.status(400).json({ ok: false, error: 'invalid_currency' });
    if (message.includes('invalid_supplier_product_id')) return res.status(400).json({ ok: false, error: 'invalid_supplier_product_id' });
    if (message.includes('invalid_supplier_url')) return res.status(400).json({ ok: false, error: 'invalid_supplier_url' });
    if (message.includes('invalid_supplier')) return res.status(400).json({ ok: false, error: 'invalid_supplier' });
    if (message.includes('invalid_image_url')) return res.status(400).json({ ok: false, error: 'invalid_image_url' });
    return res.status(500).json({ ok: false, error: 'admin_products_failed' });
  }
};
