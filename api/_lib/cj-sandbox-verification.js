const { ensureAccessToken, CJ_BASE } = require('./cj');

const FALLBACK_VARIANT_SKUS = Object.freeze([
  'CJYD206238701AZ',
  'CJYD246838701AZ',
  'CJYD205093001AZ',
  'CJLQ166764901AZ'
]);

function clean(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function rows(value) { return Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []); }
function validResponse(response) {
  const code = Number(response?.code);
  return response && response.result !== false && response.success !== false && (!Number.isFinite(code) || [0, 200].includes(code));
}

function inventoryRows(variant) { return Array.isArray(variant?.inventories) ? variant.inventories : []; }
function inventoryTotal(variant) {
  return inventoryRows(variant).reduce((sum, row) => sum + (Number(row?.totalInventory ?? row?.totalInventoryNum) || 0), 0);
}
function originCountry(variant) {
  const available = inventoryRows(variant).filter((row) => (Number(row?.totalInventory ?? row?.totalInventoryNum) || 0) > 0);
  const china = available.find((row) => clean(row?.countryCode, 2).toUpperCase() === 'CN');
  return clean(china?.countryCode || available[0]?.countryCode || 'CN', 2).toUpperCase();
}
function cheapestFreight(value) {
  return rows(value).filter((row) => row?.logisticPrice !== null && row?.logisticPrice !== undefined && String(row.logisticPrice).trim() !== '' && Number.isFinite(Number(row.logisticPrice)) && Number(row.logisticPrice) >= 0)
    .sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice))[0] || null;
}
function variantIdentity(variant) {
  return {
    vid: clean(variant?.vid || variant?.variantId || variant?.id, 160),
    sku: clean(variant?.variantSku || variant?.sku, 180),
    productId: clean(variant?.pid || variant?.productId, 180)
  };
}

function createCjRequester() {
  let lastCall = 0;
  return async function request(path, { method = 'GET', body } = {}) {
    const wait = Math.max(0, 1050 - (Date.now() - lastCall));
    if (wait) await sleep(wait);
    lastCall = Date.now();
    const token = await ensureAccessToken();
    const headers = { Accept: 'application/json', 'CJ-Access-Token': token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${CJ_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let json = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
    if (!response.ok || !validResponse(json)) throw new Error(`cj_sandbox_${json?.code || response.status}_${clean(json?.message || 'failed', 180)}`);
    return json;
  };
}

async function candidateFromVid(request, vid) {
  const result = await request(`/product/variant/queryByVid?vid=${encodeURIComponent(vid)}&features=enable_inventory`);
  return rows(result?.data)[0] || null;
}
async function candidateFromSku(request, sku) {
  const result = await request(`/product/variant/query?variantSku=${encodeURIComponent(sku)}&features=enable_inventory`);
  const candidates = rows(result?.data);
  return candidates.find((variant) => clean(variant?.variantSku, 180) === sku) || candidates[0] || null;
}

async function quoteCandidate(request, variant) {
  const identity = variantIdentity(variant);
  if (!identity.vid) return null;
  const origin = originCountry(variant);
  const freightResponse = await request('/logistic/freightCalculate', {
    method: 'POST', body: { startCountryCode: origin, endCountryCode: 'IL', products: [{ quantity: 1, vid: identity.vid }] }
  });
  const freight = cheapestFreight(freightResponse?.data);
  if (!freight) return null;
  return { variant, identity, origin, freight, inventory: inventoryTotal(variant) };
}

async function findSandboxCandidate(request, preferredVids = []) {
  const attempts = [
    ...preferredVids.filter(Boolean).map((vid) => () => candidateFromVid(request, vid)),
    ...FALLBACK_VARIANT_SKUS.map((sku) => () => candidateFromSku(request, sku))
  ];
  let lastError = null;
  for (const load of attempts) {
    try {
      const variant = await load();
      if (!variant) continue;
      const quoted = await quoteCandidate(request, variant);
      if (quoted) return quoted;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('cj_sandbox_no_product_with_israel_shipping');
}

function sandboxOrderRequest(candidate, now = Date.now()) {
  return {
    orderNumber: `AH-SBX-${now}`,
    shippingZip: '6100000', shippingCountry: 'Israel', shippingCountryCode: 'IL',
    shippingProvince: 'Tel Aviv', shippingCity: 'Tel Aviv', shippingPhone: '0500000000',
    shippingCustomerName: 'Aluf Hakelim Sandbox', shippingAddress: 'Sandbox Test Address 1',
    email: 'sandbox@aluf-hakelim.invalid', remark: 'Automated connector sandbox verification - no real fulfillment',
    payType: 3, isSandbox: 1, logisticName: clean(candidate.freight.logisticName, 50),
    fromCountryCode: candidate.origin, platform: 'Api', orderFlow: 1,
    products: [{ vid: candidate.identity.vid, sku: candidate.identity.sku, quantity: 1 }]
  };
}

function orderIdFrom(response) {
  const data = response?.data;
  return clean(typeof data === 'string' ? data : (data?.orderId || data?.id), 100);
}

async function runCjSandboxVerification({ request = createCjRequester(), preferredVids = [], now = Date.now() } = {}) {
  const candidate = await findSandboxCandidate(request, preferredVids);
  const create = await request('/shopping/order/createOrderV2', { method: 'POST', body: sandboxOrderRequest(candidate, now) });
  const orderId = orderIdFrom(create);
  if (!orderId) throw new Error('cj_sandbox_order_id_missing');

  let detail = (await request(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`))?.data || {};
  const initialStatus = clean(detail?.orderStatus || detail?.status, 30).toUpperCase();
  if (['CREATED', 'IN_CART'].includes(initialStatus)) {
    await request('/shopping/order/confirmOrder', { method: 'PATCH', body: { orderId } });
    detail = (await request(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`))?.data || {};
  }
  const beforePayment = clean(detail?.orderStatus || detail?.status, 30).toUpperCase();
  if (!['PENDING', 'PROCESSING', 'UNSHIPPED', 'SHIPPED', 'DELIVERED'].includes(beforePayment)) {
    await request('/shopping/sandbox/simulatePay', { method: 'POST', body: { orderId } });
  }

  const trackingNumber = `AH-SBX-TRACK-${now}`.slice(0, 64);
  await request('/shopping/sandbox/updateTrackNumber', { method: 'POST', body: { orderId, trackNumber: trackingNumber } });
  detail = (await request(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`))?.data || {};
  if (Number(detail?.isSandbox) !== 1) throw new Error('cj_sandbox_flag_not_confirmed');
  if (clean(detail?.trackNumber, 64) !== trackingNumber) throw new Error('cj_sandbox_tracking_not_confirmed');

  return {
    ok: true,
    verificationMode: 'sandbox',
    charged: false,
    realFulfillmentCreated: false,
    orderId,
    trackingNumber,
    product: {
      variantId: candidate.identity.vid,
      variantSku: candidate.identity.sku,
      productId: candidate.identity.productId || null,
      priceUsd: Number.isFinite(Number(candidate.variant?.variantSellPrice)) ? Number(candidate.variant.variantSellPrice) : null,
      inventory: candidate.inventory
    },
    shipping: {
      destination: 'IL', origin: candidate.origin,
      logisticName: clean(candidate.freight?.logisticName, 120),
      priceUsd: Number(candidate.freight?.logisticPrice)
    }
  };
}

module.exports = {
  FALLBACK_VARIANT_SKUS,
  cheapestFreight,
  sandboxOrderRequest,
  orderIdFrom,
  runCjSandboxVerification
};
