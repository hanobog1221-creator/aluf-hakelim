const crypto = require('crypto');
const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { quoteCjFreight } = require('../shipping');
const { readPayPalRuntimeCredentials } = require('../provider-credentials');

const TERMS_VERSION = '2026-08-17-import-compliance';
const ADMIN_NOTE = 'ADMIN PAYPAL SANDBOX TEST - NO LIVE SALE';

function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }

async function dbGet(path) {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: dbHeaders() });
  if (!r.ok) throw new Error(`db_get_${r.status}`);
  return r.json();
}

async function paypalEnv() {
  const runtime = await readPayPalRuntimeCredentials();
  return runtime?.environment === 'live' ? 'live' : 'sandbox';
}

async function readyCjProduct() {
  const readyRows = await dbGet('product_fulfillment_readiness?ready_for_paid_order=eq.true&select=id&limit=30');
  const ids = readyRows.map((row) => clean(row.id, 100)).filter(Boolean);
  if (!ids.length) throw new Error('no_ready_cj_product');
  const products = await dbGet(`products?id=in.(${encodeURIComponent(ids.join(','))})&active=eq.true&fulfillment_provider=eq.cj&fulfillment_ready=eq.true&supplier_in_stock=eq.true&supplier_shipping_available=eq.true&select=id,name,selling_price,currency,max_order_quantity,supplier,supplier_id,supplier_product_id,supplier_sku_id,variant_label,fulfillment_provider,fulfillment_product_id,fulfillment_variant_id,fulfillment_sku,fulfillment_origin_country,fulfillment_logistic_name,supplier_ship_from_country,last_sync_at&order=selling_price.asc&limit=20`);
  return products[0] || null;
}

function customerFrom(body) {
  const raw = body && typeof body.customer === 'object' ? body.customer : {};
  return {
    fullName: clean(raw.fullName, 80),
    phone: clean(raw.phone, 20),
    email: clean(raw.email, 120),
    city: clean(raw.city, 80),
    street: clean(raw.street, 100),
    houseNumber: clean(raw.houseNumber, 20),
    apartment: clean(raw.apartment, 20),
    postalCode: clean(raw.postalCode, 12),
    notes: clean(raw.notes, 300),
    countryCode: 'IL'
  };
}

function validateCustomer(customer) {
  const phoneDigits = customer.phone.replace(/\D/g, '');
  if (customer.fullName.length < 2 || customer.city.length < 2 || customer.street.length < 2 || !customer.houseNumber) return false;
  if (phoneDigits.length < 8 || phoneDigits.length > 15) return false;
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return false;
  return true;
}

async function createTestOrder(customer) {
  if (await paypalEnv() !== 'sandbox') throw new Error('paypal_not_in_sandbox');
  const product = await readyCjProduct();
  if (!product) throw new Error('no_ready_cj_product');
  const variantId = clean(product.fulfillment_variant_id || product.supplier_sku_id, 180);
  const origin = clean(product.fulfillment_origin_country || product.supplier_ship_from_country || 'CN', 2).toUpperCase();
  if (!variantId) throw new Error('cj_variant_missing');

  const freight = await quoteCjFreight({
    variantId,
    qty: 1,
    countryCode: 'IL',
    shipFromCountry: origin,
    preferredService: product.fulfillment_logistic_name || null
  });
  const price = Number(product.selling_price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid_test_product_price');
  const shippingCost = Number(freight.amountIls);
  if (!Number.isFinite(shippingCost) || shippingCost < 0) throw new Error('invalid_test_shipping');

  const now = new Date().toISOString();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const orderId = `AH-SBX-PAY-${Date.now().toString(36).toUpperCase()}-${suffix}`;
  const requestId = `sandbox_paypal_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const shippingQuote = {
    status: 'quoted',
    total: Number(shippingCost.toFixed(2)),
    currency: 'ILS',
    quotedAt: now,
    lines: [{
      id: String(product.id),
      provider: 'cj',
      qty: 1,
      cost: Number(shippingCost.toFixed(2)),
      currency: 'ILS',
      supplierAmount: Number(freight.amount),
      supplierCurrency: freight.currency || 'USD',
      serviceName: freight.serviceName,
      estimatedDeliveryTime: freight.estimatedDeliveryTime || null
    }]
  };
  const item = {
    id: String(product.id),
    name: String(product.name),
    qty: 1,
    price: Number(price.toFixed(2)),
    variant: product.variant_label || null,
    supplier: 'cj',
    supplierId: product.supplier_id || null,
    supplierProductId: product.supplier_product_id,
    supplierSkuId: product.supplier_sku_id,
    supplierShipFromCountry: origin,
    fulfillmentProvider: 'cj',
    fulfillmentReady: true,
    supplierStockKnown: true,
    supplierSyncedAt: product.last_sync_at || now,
    alternativeSuppliers: []
  };

  const order = {
    order_id: orderId,
    client_request_id: requestId,
    status: 'draft',
    payment_status: 'unpaid',
    payment_provider: 'paypal',
    payment_reference: null,
    fulfillment_status: 'not_started',
    currency: 'ILS',
    products_subtotal: Number(price.toFixed(2)),
    discount_amount: 0,
    coupon_code: null,
    total: Number(price.toFixed(2)),
    shipping_cost: Number(shippingCost.toFixed(2)),
    shipping_quote_status: 'quoted',
    shipping_quote: shippingQuote,
    shipping_quoted_at: now,
    estimated_import_tax: 0,
    items: [item],
    customer,
    terms_accepted_at: now,
    terms_version: TERMS_VERSION,
    admin_note: ADMIN_NOTE,
    supplier_order_ids: [],
    created_at: now,
    updated_at: now
  };

  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(order)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`sandbox_order_insert_${response.status}_${text.slice(0, 180)}`);
  await audit('paypal_sandbox_test_created', 'order', orderId, { productId: product.id, shippingService: freight.serviceName });
  return {
    orderId,
    product: { id: product.id, name: product.name, price: Number(price.toFixed(2)) },
    shippingCost: Number(shippingCost.toFixed(2)),
    total: Number((price + shippingCost).toFixed(2)),
    currency: 'ILS',
    shippingService: freight.serviceName,
    paypalEnvironment: 'sandbox'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const product = await readyCjProduct();
      return res.status(200).json({ ok: true, paypalEnvironment: await paypalEnv(), ready: Boolean(product), product: product ? { id: product.id, name: product.name, price: Number(product.selling_price) } : null });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const customer = customerFrom(body);
    if (!validateCustomer(customer)) return res.status(400).json({ ok: false, error: 'invalid_customer' });
    return res.status(200).json({ ok: true, ...(await createTestOrder(customer)) });
  } catch (error) {
    console.error('PayPal sandbox admin test failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message, 240) });
  }
};
