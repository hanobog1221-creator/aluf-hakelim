const { quoteCartShipping } = require('./_lib/shipping');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requestedItems = Array.isArray(body.items) ? body.items : [];

    if (!requestedItems.length || requestedItems.length > 30) {
      return res.status(400).json({ ok: false, error: 'empty_or_oversized_cart' });
    }

    const requested = requestedItems
      .map((item) => ({
        id: String(item.id || ''),
        qty: Math.min(20, Math.max(1, Math.floor(Number(item.qty || 1))))
      }))
      .filter((item) => /^[A-Za-z0-9_-]+$/.test(item.id) && Number.isFinite(item.qty));

    if (!requested.length) {
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

    const supabaseUrl = (process.env.SUPABASE_URL || 'https://sapuzlieyxwlcjdzkzrb.supabase.co').replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is missing');
      return res.status(500).json({ ok: false, error: 'server_not_configured' });
    }

    const uniqueIds = [...new Set(requested.map((item) => item.id))];
    const idFilter = uniqueIds.join(',');
    const productResponse = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,name,selling_price,currency,active,supplier,supplier_url,supplier_product_id,supplier_sku_id,variant_label,fulfillment_ready,supplier_in_stock,supplier_shipping,shipping_currency,last_sync_at,supplier_ship_from_country&id=in.(${encodeURIComponent(idFilter)})`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!productResponse.ok) {
      const details = await productResponse.text();
      console.error('Supabase product lookup failed:', productResponse.status, details);
      return res.status(500).json({ ok: false, error: 'catalog_lookup_failed' });
    }

    const products = await productResponse.json();
    const byId = new Map(products.map((product) => [String(product.id), product]));

    const normalized = [];
    for (const item of requested) {
      const product = byId.get(item.id);
      if (!product || product.active !== true || product.supplier_in_stock === false) {
        return res.status(409).json({ ok: false, error: 'product_unavailable', productId: item.id });
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
        supplierUrl: product.supplier_url || null,
        supplierProductId: product.supplier_product_id || null,
        supplierSkuId: product.supplier_sku_id || null,
        supplierShipFromCountry: product.supplier_ship_from_country || 'CN',
        fulfillmentReady: Boolean(product.fulfillment_ready),
        supplierStockKnown: product.supplier_in_stock !== null,
        supplierSyncedAt: product.last_sync_at || null
      });
    }

    const productsSubtotal = Number(normalized.reduce((sum, item) => sum + item.price * item.qty, 0).toFixed(2));
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
    const finalTotal = Number((productsSubtotal + shippingCost).toFixed(2));

    if (body.quoteOnly === true) {
      return res.status(200).json({
        ok: true,
        quoteOnly: true,
        productsSubtotal,
        shippingStatus: shippingQuote.status,
        shippingCost: shippingQuote.status === 'quoted' ? shippingCost : null,
        shippingCurrency: 'ILS',
        shippingLines: shippingQuote.lines || [],
        total: shippingQuote.status === 'quoted' ? finalTotal : null,
        canFinalize: shippingQuote.status === 'quoted',
        waitingForAliExpressPermission: Boolean(shippingQuote.waitingForAliExpressPermission)
      });
    }

    const orderId = `AH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const order = {
      order_id: orderId,
      status: 'draft',
      payment_status: 'unpaid',
      fulfillment_status: 'not_started',
      currency: 'ILS',
      total: finalTotal,
      shipping_cost: shippingCost,
      shipping_quote_status: shippingQuote.status,
      shipping_quote: shippingQuote,
      shipping_quoted_at: shippingQuote.quotedAt || null,
      items: normalized,
      customer,
      created_at: now,
      updated_at: now
    };

    const dbResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(order)
    });

    if (!dbResponse.ok) {
      const details = await dbResponse.text();
      console.error('Supabase order insert failed:', dbResponse.status, details);
      return res.status(500).json({ ok: false, error: 'order_storage_failed' });
    }

    return res.status(200).json({
      ok: true,
      persisted: true,
      orderId,
      status: order.status,
      paymentStatus: order.payment_status,
      fulfillmentStatus: order.fulfillment_status,
      productsSubtotal,
      shippingStatus: shippingQuote.status,
      shippingCost: shippingQuote.status === 'quoted' ? shippingCost : null,
      shippingCurrency: 'ILS',
      shippingLines: shippingQuote.lines || [],
      total: order.total,
      currency: order.currency,
      items: normalized,
      waitingForAliExpressPermission: Boolean(shippingQuote.waitingForAliExpressPermission)
    });
  } catch (error) {
    console.error('Order API error:', error);
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
};
