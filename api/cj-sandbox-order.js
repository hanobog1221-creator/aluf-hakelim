const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');
const { quoteCjFreight } = require('./_lib/shipping');
const { serverConfig, serverHeaders } = require('./_lib/supabase-server');

async function readTestProduct() {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.ae-1005010757861759&select=id,name,fulfillment_provider,fulfillment_product_id,fulfillment_variant_id,fulfillment_sku,fulfillment_origin_country,fulfillment_provider_status&limit=1`, { headers: serverHeaders() });
  if (!r.ok) throw new Error(`sandbox_product_read_${r.status}`);
  const p = (await r.json())[0];
  if (!p || p.fulfillment_provider !== 'cj' || !p.fulfillment_product_id || !p.fulfillment_variant_id || !p.fulfillment_sku) throw new Error('sandbox_product_not_mapped');
  return p;
}

async function createSandboxOrder(product, freight) {
  const token = await ensureAccessToken();
  const orderNumber = `AH-SBX-${Date.now().toString(36).toUpperCase()}`;
  const payload = {
    orderNumber,
    shippingZip: '9100001',
    shippingCountry: 'Israel',
    shippingCountryCode: 'IL',
    shippingProvince: 'Jerusalem',
    shippingCity: 'Jerusalem',
    shippingPhone: '0500000000',
    shippingCustomerName: 'Aluf Hakelim Sandbox',
    shippingAddress: 'Jaffa Street',
    houseNumber: '1',
    email: 'sandbox@example.com',
    remark: 'ALUF HAKELIM API SANDBOX - NO REAL FULFILLMENT',
    payType: 3,
    isSandbox: 1,
    logisticName: freight.serviceName,
    fromCountryCode: product.fulfillment_origin_country || 'CN',
    platform: 'Api',
    orderFlow: 1,
    products: [{
      vid: product.fulfillment_variant_id,
      sku: product.fulfillment_sku,
      quantity: 1,
      storeProductId: product.id,
      storeProductName: product.name,
      storeLineItemId: `sbx-${product.id}`
    }]
  };
  const r = await fetch(`${CJ_BASE}/shopping/order/createOrderV2`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'CJ-Access-Token': token },
    body: JSON.stringify(payload)
  });
  const raw = await r.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  const code = Number(json?.code);
  if (!r.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0, 200].includes(code))) {
    throw new Error(`cj_sandbox_${json?.code || r.status}_${String(json?.message || 'failed').slice(0, 220)}`);
  }
  return { orderNumber, data: json.data || {}, requestId: json.requestId || null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV === 'production') return res.status(403).json({ ok: false, error: 'sandbox_preview_only' });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const product = await readTestProduct();
    const freight = await quoteCjFreight({ variantId: product.fulfillment_variant_id, qty: 1, countryCode: 'IL', shipFromCountry: product.fulfillment_origin_country || 'CN', preferredService: 'CJPacket Liquid Line' });
    const created = await createSandboxOrder(product, freight);
    return res.status(200).json({
      ok: true,
      sandbox: true,
      charged: false,
      product: { id: product.id, cjProductId: product.fulfillment_product_id, cjVariantId: product.fulfillment_variant_id, cjSku: product.fulfillment_sku },
      freight: { serviceName: freight.serviceName, amountUsd: freight.amount, amountIls: freight.amountIls, aging: freight.estimatedDeliveryTime },
      order: { orderNumber: created.orderNumber, cjOrderId: created.data.orderId || null, status: created.data.orderStatus || null, logisticsMiss: created.data.logisticsMiss ?? null, orderAmount: created.data.orderAmount ?? null, postageAmount: created.data.postageAmount ?? null, productAmount: created.data.productAmount ?? null },
      requestId: created.requestId
    });
  } catch (error) {
    console.error('CJ sandbox test failed:', error.message);
    return res.status(500).json({ ok: false, sandbox: true, charged: false, error: error.message || 'cj_sandbox_failed' });
  }
};
