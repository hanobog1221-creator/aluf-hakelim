const crypto = require('crypto');
const { quoteCartShipping } = require('./_lib/shipping');
const { serverHeaders } = require('./_lib/supabase-server');
const { buildImportCompliancePlan } = require('./_lib/import-compliance');

const TERMS_VERSION = '2026-08-17-import-compliance';

function normalizeCouponCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return '__INVALID__';
  return code;
}

function normalizeRequestId(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  return /^[A-Za-z0-9_-]{8,100}$/.test(id) ? id : '__INVALID__';
}

function customerItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: String(item.id || ''),
    name: String(item.name || ''),
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    variant: item.variant || null
  }));
}

function customerShippingLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    id: String(line.id || ''),
    qty: Number(line.qty || 0),
    cost: Number(line.cost || 0),
    currency: 'ILS',
    estimatedDeliveryTime: line.estimatedDeliveryTime || null
  }));
}

function customerShippingStatus(status) {
  if (status === 'quoted') return 'quoted';
  if (status === 'failed') return 'unavailable';
  return 'pending';
}

function shippingPending(quote) {
  return quote?.status !== 'quoted' && Boolean(quote?.waitingForAliExpressPermission);
}

function customerImportPlan(plan) {
  if (!plan) return null;
  const shipmentCount = Array.isArray(plan.groups) ? plan.groups.length : 0;
  return {
    shipmentCount,
    hasVerifiedSupplierSplit: shipmentCount > 1,
    estimatedImportTax: Number(plan.estimatedTaxIls || 0),
    taxEstimateOnly: plan.taxEstimateOnly === true,
    complianceNotice: plan.complianceNotice || null
  };
}

function requestFingerprint(req, kind) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(`${kind}:${ip}`).digest('hex');
}

async function consumeRateLimit({ req, supabaseUrl, serviceKey, quoteOnly }) {
  const kind = quoteOnly ? 'quote' : 'order';
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_rate_limit`, {
    method: 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json' }, serviceKey),
    body: JSON.stringify({
      p_key: requestFingerprint(req, kind),
      p_limit: quoteOnly ? 60 : 15,
      p_window_seconds: quoteOnly ? 600 : 3600
    })
  });
  if (!response.ok) throw new Error(`rate_limit_check_${response.status}`);
  return (await response.json()) === true;
}

async function readSalesEnabled({ supabaseUrl, serviceKey }) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled&limit=1`,
    { headers: serverHeaders({}, serviceKey) }
  );
  if (!response.ok) throw new Error(`sales_settings_read_${response.status}`);
  const row = (await response.json())[0] || {};
  return row.sales_enabled === true;
}

async function calculateCoupon({ supabaseUrl, serviceKey, code, productsSubtotal }) {
  if (!code) return { code: null, discountAmount: 0, coupon: null };
  if (code === '__INVALID__') {
    const error = new Error('invalid_coupon');
    error.code = 'invalid_coupon';
    throw error;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/coupons?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
    { headers: serverHeaders({}, serviceKey) }
  );
  if (!response.ok) throw new Error(`coupon_lookup_${response.status}`);
  const coupon = (await response.json())[0];
  if (!coupon || coupon.active !== true) {
    const error = new Error('coupon_not_found');
    error.code = 'coupon_not_found';
    throw error;
  }

  const now = Date.now();
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) {
    const error = new Error('coupon_not_started');
    error.code = 'coupon_not_started';
    throw error;
  }
  if (coupon.ends_at && Date.parse(coupon.ends_at) < now) {
    const error = new Error('coupon_expired');
    error.code = 'coupon_expired';
    throw error;
  }
  if (coupon.usage_limit != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
    const error = new Error('coupon_limit_reached');
    error.code = 'coupon_limit_reached';
    throw error;
  }

  const minOrder = Number(coupon.min_order || 0);
  if (productsSubtotal < minOrder) {
    const error = new Error('coupon_min_order');
    error.code = 'coupon_min_order';
    error.minOrder = minOrder;
    throw error;
  }

  const value = Number(coupon.discount_value || 0);
  let discountAmount = 0;
  if (coupon.discount_type === 'percent') {
    discountAmount = productsSubtotal * Math.min(100, Math.max(0, value)) / 100;
  } else if (coupon.discount_type === 'fixed') {
    discountAmount = value;
  } else {
    throw new Error('coupon_type_invalid');
  }

  if (coupon.max_discount != null) {
    discountAmount = Math.min(discountAmount, Math.max(0, Number(coupon.max_discount)));
  }
  discountAmount = Number(Math.min(productsSubtotal, Math.max(0, discountAmount)).toFixed(2));

  return {
    code,
    discountAmount,
    coupon: {
      code,
      discountType: coupon.discount_type,
      discountValue: value,
      minOrder,
      maxDiscount: coupon.max_discount == null ? null : Number(coupon.max_discount)
    }
  };
}

function responseFromStoredOrder(order, duplicate = true) {
  const productsSubtotal = Number(order.products_subtotal ?? (Number(order.total || 0) + Number(order.discount_amount || 0)));
  const discountAmount = Number(order.discount_amount || 0);
  const discountedProductsSubtotal = Number(order.total || 0);
  const shippingCostRaw = Number(order.shipping_cost || 0);
  const internalShippingStatus = order.shipping_quote_status || 'failed';
  const shippingCost = internalShippingStatus === 'quoted' ? shippingCostRaw : null;
  const finalTotal = Number((discountedProductsSubtotal + shippingCostRaw).toFixed(2));
  return {
    ok: true,
    persisted: true,
    duplicate,
    orderId: order.order_id,
    status: order.status,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    productsSubtotal,
    discountAmount,
    discountedProductsSubtotal,
    couponCode: order.coupon_code || null,
    coupon: null,
    shippingStatus: customerShippingStatus(internalShippingStatus),
    shippingPending: shippingPending(order.shipping_quote),
    shippingCost,
    shippingCurrency: 'ILS',
    shippingLines: customerShippingLines(order.shipping_quote?.lines),
    importPlan: customerImportPlan(order.import_compliance_plan),
    estimatedImportTax: Number(order.estimated_import_tax || 0),
    estimatedTotalWithImportTax: Number((finalTotal + Number(order.estimated_import_tax || 0)).toFixed(2)),
    total: finalTotal,
    currency: order.currency || 'ILS',
    items: customerItems(order.items)
  };
}

async function findExistingRequest({ supabaseUrl, serviceKey, requestId }) {
  if (!requestId) return null;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?client_request_id=eq.${encodeURIComponent(requestId)}&select=*&limit=1`,
    { headers: serverHeaders({}, serviceKey) }
  );
  if (!response.ok) throw new Error(`idempotency_lookup_${response.status}`);
  return (await response.json())[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requestedItems = Array.isArray(body.items) ? body.items : [];

    if (body.termsAccepted !== true) {
      return res.status(400).json({ ok: false, error: 'terms_required' });
    }

    if (!requestedItems.length || requestedItems.length > 30) {
      return res.status(400).json({ ok: false, error: 'empty_or_oversized_cart' });
    }

    const requested = requestedItems
      .map((item) => ({
        id: String(item.id || ''),
        qty: Math.floor(Number(item.qty || 1))
      }))
      .filter((item) => /^[A-Za-z0-9_-]+$/.test(item.id) && Number.isInteger(item.qty) && item.qty >= 1 && item.qty <= 20);

    if (!requested.length || requested.length !== requestedItems.length) {
      return res.status(400).json({ ok: false, error: 'invalid_items' });
    }

    const rawCustomer = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const clean = (value, max) => String(value || '').trim().slice(0, max);
    const customer = {
      fullName: clean(rawCustomer.fullName, 80),
      phone: clean(rawCustomer.phone, 20),
      email: clean(rawCustomer.email, 120),
      city: clean(rawCustomer.city, 80),
      street: clean(rawCustomer.street, 100),
      houseNumber: clean(rawCustomer.houseNumber, 20),
      apartment: clean(rawCustomer.apartment, 20),
      postalCode: clean(rawCustomer.postalCode, 12),
      notes: clean(rawCustomer.notes, 300),
      countryCode: 'IL'
    };

    const phoneDigits = customer.phone.replace(/\D/g, '');
    const emailValid = !customer.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email);
    if (
      customer.fullName.length < 2 ||
      customer.city.length < 2 ||
      customer.street.length < 2 ||
      !customer.houseNumber ||
      phoneDigits.length < 8 || phoneDigits.length > 15 ||
      !emailValid
    ) {
      return res.status(400).json({ ok: false, error: 'invalid_customer' });
    }

    const requestId = normalizeRequestId(body.clientRequestId);
    if (requestId === '__INVALID__') return res.status(400).json({ ok: false, error: 'invalid_request_id' });

    const supabaseUrl = (process.env.SUPABASE_URL || 'https://sapuzlieyxwlcjdzkzrb.supabase.co').replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is missing');
      return res.status(500).json({ ok: false, error: 'server_not_configured' });
    }

    const quoteOnly = body.quoteOnly === true;
    const salesEnabled = await readSalesEnabled({ supabaseUrl, serviceKey });
    if (!quoteOnly && !salesEnabled) {
      return res.status(503).json({ ok: false, error: 'sales_disabled' });
    }

    const allowed = await consumeRateLimit({ req, supabaseUrl, serviceKey, quoteOnly });
    if (!allowed) {
      res.setHeader('Retry-After', quoteOnly ? '600' : '3600');
      return res.status(429).json({ ok: false, error: 'too_many_requests' });
    }

    if (!quoteOnly && requestId) {
      const existing = await findExistingRequest({ supabaseUrl, serviceKey, requestId });
      if (existing) {
        const existingPhone = String(existing.customer?.phone || '').replace(/\D/g, '');
        if (existingPhone !== phoneDigits) return res.status(409).json({ ok: false, error: 'idempotency_conflict' });
        return res.status(200).json(responseFromStoredOrder(existing, true));
      }
    }

    const uniqueIds = [...new Set(requested.map((item) => item.id))];
    const idFilter = uniqueIds.join(',');
    const productResponse = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,currency,active,max_order_quantity,supplier,supplier_id,supplier_url,supplier_product_id,supplier_sku_id,variant_label,alternative_suppliers,fulfillment_ready,supplier_in_stock,supplier_shipping_available,supplier_shipping,shipping_currency,last_sync_at,supplier_ship_from_country&id=in.(${encodeURIComponent(idFilter)})`,
      { headers: serverHeaders({}, serviceKey) }
    );

    if (!productResponse.ok) {
      const details = await productResponse.text();
      console.error('Supabase product lookup failed:', productResponse.status, details);
      return res.status(500).json({ ok: false, error: 'catalog_lookup_failed' });
    }

    const products = await productResponse.json();
    const byId = new Map(products.map((product) => [String(product.id), product]));

    let normalized = [];
    for (const item of requested) {
      const product = byId.get(item.id);
      if (!product || product.active !== true) {
        return res.status(409).json({ ok: false, error: 'product_unavailable', productId: item.id });
      }

      if (!quoteOnly && (
        product.fulfillment_ready !== true ||
        product.supplier_in_stock !== true ||
        product.supplier_shipping_available !== true ||
        !product.supplier_product_id ||
        !product.supplier_sku_id
      )) {
        return res.status(409).json({ ok: false, error: 'product_not_purchase_ready', productId: item.id });
      }

      if (quoteOnly && (product.supplier_in_stock === false || product.supplier_shipping_available === false)) {
        return res.status(409).json({ ok: false, error: 'product_unavailable', productId: item.id });
      }

      const maxQty = Math.max(1, Math.min(20, Number(product.max_order_quantity || 20)));
      if (item.qty > maxQty) {
        return res.status(409).json({ ok: false, error: 'quantity_limit', productId: item.id, maxQty });
      }

      const price = Number(product.selling_price);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(500).json({ ok: false, error: 'invalid_catalog_price', productId: item.id });
      }

      normalized.push({
        id: String(product.id),
        name: String(product.name),
        qty: item.qty,
        price,
        variant: product.variant_label || null,
        supplier: product.supplier || null,
        supplierId: product.supplier_id || null,
        supplierUrl: product.supplier_url || null,
        supplierProductId: product.supplier_product_id || null,
        supplierSkuId: product.supplier_sku_id || null,
        supplierShipFromCountry: product.supplier_ship_from_country || 'CN',
        fulfillmentReady: Boolean(product.fulfillment_ready),
        supplierStockKnown: product.supplier_in_stock !== null,
        supplierSyncedAt: product.last_sync_at || null,
        alternativeSuppliers: Array.isArray(product.alternative_suppliers) ? product.alternative_suppliers : []
      });
    }

    const productsSubtotal = Number(normalized.reduce((sum, item) => sum + item.price * item.qty, 0).toFixed(2));
    const couponCode = normalizeCouponCode(body.couponCode);
    let couponResult;
    try {
      couponResult = await calculateCoupon({ supabaseUrl, serviceKey, code: couponCode, productsSubtotal });
    } catch (error) {
      const code = String(error.code || error.message || error);
      return res.status(400).json({
        ok: false,
        error: code,
        minOrder: error.minOrder == null ? null : Number(error.minOrder)
      });
    }

    const discountAmount = Number(couponResult.discountAmount || 0);
    const discountedProductsSubtotal = Number(Math.max(0, productsSubtotal - discountAmount).toFixed(2));

    const plannedImport = buildImportCompliancePlan(normalized, {
      thresholdUsd: Number(process.env.PERSONAL_IMPORT_THRESHOLD_USD || 75),
      usdIlsRate: Number(process.env.IMPORT_USD_ILS_RATE || 3.7),
      vatRate: Number(process.env.IMPORT_VAT_RATE || 0.18)
    });
    normalized = plannedImport.assignedItems;
    const { assignedItems: _assignedItems, ...importPlan } = plannedImport;

    if (!quoteOnly && importPlan.estimatedTaxIls > 0 && body.importChargesAccepted !== true) {
      return res.status(400).json({ ok: false, error: 'import_charges_consent_required' });
    }

    let shippingQuote;
    try {
      shippingQuote = await quoteCartShipping(normalized, customer.countryCode);
    } catch (error) {
      const code = String(error.code || error.message || error);
      const waitingForAliExpressPermission = code.includes('InsufficientPermission') || code.includes('InvalidApiPath');
      shippingQuote = {
        status: waitingForAliExpressPermission ? 'pending_permission' : 'failed',
        total: null,
        currency: 'ILS',
        quotedAt: null,
        lines: [],
        error: code.slice(0, 300),
        waitingForAliExpressPermission
      };
    }

    const shippingCost = shippingQuote.status === 'quoted' ? Number(shippingQuote.total || 0) : 0;
    const finalTotal = Number((discountedProductsSubtotal + shippingCost).toFixed(2));

    const priceSummary = {
      productsSubtotal,
      discountAmount,
      discountedProductsSubtotal,
      couponCode: couponResult.code,
      coupon: couponResult.coupon
    };

    if (quoteOnly) {
      return res.status(200).json({
        ok: true,
        quoteOnly: true,
        salesEnabled,
        ...priceSummary,
        shippingStatus: customerShippingStatus(shippingQuote.status),
        shippingPending: shippingPending(shippingQuote),
        shippingCost: shippingQuote.status === 'quoted' ? shippingCost : null,
        shippingCurrency: 'ILS',
        shippingLines: customerShippingLines(shippingQuote.lines),
        importPlan: customerImportPlan(importPlan),
        estimatedImportTax: importPlan.estimatedTaxIls,
        estimatedTotalWithImportTax: shippingQuote.status === 'quoted'
          ? Number((finalTotal + importPlan.estimatedTaxIls).toFixed(2))
          : null,
        total: shippingQuote.status === 'quoted' ? finalTotal : null,
        canFinalize: salesEnabled && normalized.every((item) => item.fulfillmentReady) && shippingQuote.status === 'quoted'
      });
    }

    if (shippingQuote.status !== 'quoted') {
      return res.status(409).json({
        ok: false,
        error: shippingQuote.waitingForAliExpressPermission ? 'supplier_permission_pending' : 'shipping_unavailable'
      });
    }

    const orderId = `AH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const order = {
      order_id: orderId,
      client_request_id: requestId,
      status: 'draft',
      payment_status: 'unpaid',
      fulfillment_status: 'not_started',
      currency: 'ILS',
      products_subtotal: productsSubtotal,
      discount_amount: discountAmount,
      coupon_code: couponResult.code,
      total: discountedProductsSubtotal,
      shipping_cost: shippingCost,
      shipping_quote_status: shippingQuote.status,
      shipping_quote: shippingQuote,
      shipping_quoted_at: shippingQuote.quotedAt || null,
      import_compliance_plan: importPlan,
      estimated_import_tax: importPlan.estimatedTaxIls,
      import_charges_accepted_at: importPlan.estimatedTaxIls > 0 ? now : null,
      items: normalized,
      customer,
      terms_accepted_at: now,
      terms_version: TERMS_VERSION,
      created_at: now,
      updated_at: now
    };

    const dbResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: serverHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }, serviceKey),
      body: JSON.stringify(order)
    });

    if (!dbResponse.ok) {
      const details = await dbResponse.text();
      if (dbResponse.status === 409 && requestId) {
        const existing = await findExistingRequest({ supabaseUrl, serviceKey, requestId });
        if (existing) {
          const existingPhone = String(existing.customer?.phone || '').replace(/\D/g, '');
          if (existingPhone === phoneDigits) return res.status(200).json(responseFromStoredOrder(existing, true));
        }
      }
      console.error('Supabase order insert failed:', dbResponse.status, details);
      return res.status(500).json({ ok: false, error: 'order_storage_failed' });
    }

    return res.status(200).json({
      ok: true,
      persisted: true,
      duplicate: false,
      orderId,
      status: order.status,
      paymentStatus: order.payment_status,
      fulfillmentStatus: order.fulfillment_status,
      ...priceSummary,
      shippingStatus: customerShippingStatus(shippingQuote.status),
      shippingPending: false,
      shippingCost,
      shippingCurrency: 'ILS',
      shippingLines: customerShippingLines(shippingQuote.lines),
      importPlan: customerImportPlan(importPlan),
      estimatedImportTax: importPlan.estimatedTaxIls,
      estimatedTotalWithImportTax: Number((finalTotal + importPlan.estimatedTaxIls).toFixed(2)),
      total: finalTotal,
      currency: order.currency,
      items: customerItems(normalized)
    });
  } catch (error) {
    console.error('Order API error:', error);
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
};

