const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken, callTopApi } = require('./aliexpress');
const { ensureAccessToken, CJ_BASE } = require('./cj');
const { serverConfig, serverHeaders } = require('./supabase-server');

const FREIGHT_PATH = '/logistics/buyer/freight/calculate';
const FREIGHT_METHOD = 'aliexpress.logistics.buyer.freight.calculate';
const FX_MEMORY_TTL_MS = 15 * 60 * 1000;
const FX_DB_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const fxMemory = new Map();

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function fxKey(base, quote = 'ILS') {
  return `${base}:${quote}`;
}

function rememberFx(base, quote, rate) {
  fxMemory.set(fxKey(base, quote), { rate: Number(rate), at: Date.now() });
}

function memoryFx(base, quote) {
  const row = fxMemory.get(fxKey(base, quote));
  if (!row || !Number.isFinite(row.rate) || row.rate <= 0 || Date.now() - row.at > FX_MEMORY_TTL_MS) return null;
  return row.rate;
}

async function readCachedFxRate(base, quote = 'ILS') {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/fx_rates?base_currency=eq.${encodeURIComponent(base)}&quote_currency=eq.${encodeURIComponent(quote)}&select=rate,fetched_at&limit=1`,
    { headers: serverHeaders() }
  );
  if (!response.ok) throw new Error(`fx_cache_read_${response.status}`);
  const row = (await response.json())[0] || null;
  if (!row) return null;
  const rate = Number(row.rate);
  const fetchedAt = Date.parse(row.fetched_at || '');
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(fetchedAt)) return null;
  if (Date.now() - fetchedAt > FX_DB_MAX_AGE_MS) return null;
  return rate;
}

async function saveCachedFxRate(base, quote, rate, source = 'frankfurter') {
  const { supabaseUrl } = serverConfig();
  const now = new Date().toISOString();
  const response = await fetch(`${supabaseUrl}/rest/v1/fx_rates?on_conflict=base_currency,quote_currency`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      base_currency: base,
      quote_currency: quote,
      rate,
      source,
      fetched_at: now,
      updated_at: now
    })
  });
  if (!response.ok) throw new Error(`fx_cache_write_${response.status}`);
}

async function convertToIls(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('invalid_shipping_amount');
  const code = cleanCurrency(currency);
  if (!code) throw new Error('invalid_shipping_currency');
  if (code === 'ILS') return Number(numeric.toFixed(2));

  const inMemory = memoryFx(code, 'ILS');
  if (inMemory) return Number((numeric * inMemory).toFixed(2));

  let remoteError = null;
  try {
    const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(code)}&to=ILS`, {
      headers: { accept: 'application/json' },
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(7000) : undefined
    });
    if (!response.ok) throw new Error(`fx_unavailable_${response.status}`);
    const data = await response.json();
    const rate = Number(data?.rates?.ILS);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('fx_rate_missing');
    rememberFx(code, 'ILS', rate);
    saveCachedFxRate(code, 'ILS', rate).catch((error) => console.warn('FX cache write failed:', error.message));
    return Number((numeric * rate).toFixed(2));
  } catch (error) {
    remoteError = error;
  }

  try {
    const cachedRate = await readCachedFxRate(code, 'ILS');
    if (cachedRate) {
      rememberFx(code, 'ILS', cachedRate);
      return Number((numeric * cachedRate).toFixed(2));
    }
  } catch (cacheError) {
    console.warn('FX cache fallback failed:', cacheError.message);
  }

  throw remoteError || new Error('fx_unavailable');
}

function parseFreightOptions(json) {
  const root = json?.aliexpress_logistics_buyer_freight_calculate_response || json;
  const result = root?.result || json?.result;
  if (!result) return [];
  const list = result?.aeop_freight_calculate_result_for_buyer_d_t_o_list?.aeop_freight_calculate_result_for_buyer_dto
    || result?.aeop_freight_calculate_result_for_buyer_d_t_o_list?.aeop_freight_calculate_result_for_buyer_d_t_o
    || result?.aeopFreightCalculateResultForBuyerDTOList
    || [];

  return asArray(list).map((row) => {
    const amount = Number(row?.freight?.amount ?? row?.freight_amount);
    const currency = cleanCurrency(row?.freight?.currency_code || row?.currency_code);
    const errorCode = row?.error_code == null ? 0 : Number(row.error_code);
    const successful = row?.success === false ? false : (!Number.isFinite(errorCode) || errorCode === 0);
    return {
      successful,
      amount: Number.isFinite(amount) ? amount : null,
      currency,
      serviceName: row?.service_name || null,
      estimatedDeliveryTime: row?.estimated_delivery_time || null,
      errorCode: row?.error_code ?? null
    };
  }).filter((row) => row.successful && row.amount != null && row.currency);
}

function freightDto({ productId, qty, countryCode, shipFromCountry }) {
  return {
    country_code: String(countryCode || 'IL').toUpperCase(),
    product_id: Number(productId),
    product_num: Math.max(1, Math.min(20, Math.floor(Number(qty || 1)))),
    send_goods_country_code: String(shipFromCountry || 'CN').toUpperCase()
  };
}

async function quoteFreightTop(input) {
  const dto = freightDto(input);
  const json = await callTopApi(FREIGHT_METHOD, {
    param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify(dto)
  });
  const options = parseFreightOptions(json);
  if (!options.length) {
    const result = json?.aliexpress_logistics_buyer_freight_calculate_response?.result || json?.result;
    const error = new Error(result?.error_desc || 'no_shipping_option');
    error.code = 'no_shipping_option';
    throw error;
  }
  return options;
}

async function quoteFreightLegacy(input) {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  const accessToken = await getValidAccessToken();
  const dto = freightDto(input);
  const params = {
    app_key: APP_KEY,
    access_token: accessToken,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify(dto)
  };
  params.sign = signAliExpress(params, secret, FREIGHT_PATH);

  const response = await fetch(`${API_BASE}${FREIGHT_PATH}?${new URLSearchParams(params).toString()}`, {
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  const errorCode = json?.code || json?.error_response?.sub_code || json?.error_response?.code;
  if (!response.ok || !json || errorCode) {
    const error = new Error(String(errorCode || `freight_http_${response.status}`));
    error.code = String(errorCode || `freight_http_${response.status}`);
    error.details = text.slice(0, 1200);
    throw error;
  }

  const options = parseFreightOptions(json);
  if (!options.length) {
    const result = json?.aliexpress_logistics_buyer_freight_calculate_response?.result || json?.result;
    const error = new Error(result?.error_desc || 'no_shipping_option');
    error.code = 'no_shipping_option';
    throw error;
  }
  return options;
}

async function quoteAliExpressFreight({ productId, qty, countryCode = 'IL', shipFromCountry = 'CN' }) {
  if (!/^\d{8,20}$/.test(String(productId || ''))) throw new Error('bad_supplier_product_id');
  const input = { productId, qty, countryCode, shipFromCountry };
  let options;
  try {
    options = await quoteFreightTop(input);
  } catch (topError) {
    try {
      options = await quoteFreightLegacy(input);
    } catch (legacyError) {
      if (/permission|authorize/i.test(String(topError.code || topError.message || ''))) throw topError;
      throw legacyError;
    }
  }

  const withIls = [];
  for (const option of options) {
    const ils = await convertToIls(option.amount, option.currency);
    withIls.push({ ...option, amountIls: ils });
  }
  withIls.sort((a, b) => a.amountIls - b.amountIls);
  return withIls[0];
}

function cjFreightRows(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.list) ? data.list
      : Array.isArray(data?.freightList) ? data.freightList
        : Array.isArray(data?.logisticList) ? data.logisticList
          : [];
  return list.map((row) => ({
    amount: Number(row?.logisticPrice ?? row?.shippingCost ?? row?.price),
    currency: 'USD',
    serviceName: row?.logisticName || row?.logisticsName || row?.enName || null,
    estimatedDeliveryTime: row?.logisticAging || row?.logisticsTimeliness || row?.aging || null
  })).filter((row) => Number.isFinite(row.amount) && row.amount >= 0 && row.serviceName);
}

async function quoteCjFreight({ variantId, qty, countryCode = 'IL', shipFromCountry = 'CN', preferredService = null }) {
  if (!String(variantId || '').trim()) throw new Error('cj_variant_id_missing');
  const token = await ensureAccessToken();
  const response = await fetch(`${CJ_BASE}/logistic/freightCalculate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CJ-Access-Token': token
    },
    body: JSON.stringify({
      startCountryCode: String(shipFromCountry || 'CN').toUpperCase(),
      endCountryCode: String(countryCode || 'IL').toUpperCase(),
      products: [{ quantity: Math.max(1, Math.min(20, Math.floor(Number(qty || 1)))), vid: String(variantId) }]
    })
  });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  const code = Number(json?.code);
  if (!response.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0, 200].includes(code))) {
    throw new Error(`cj_freight_${json?.code || response.status}_${String(json?.message || 'failed').slice(0, 180)}`);
  }

  const options = cjFreightRows(json?.data);
  if (!options.length) throw new Error('cj_shipping_unavailable');
  const withIls = [];
  for (const option of options) {
    withIls.push({ ...option, amountIls: await convertToIls(option.amount, 'USD') });
  }
  withIls.sort((a, b) => a.amountIls - b.amountIls);
  if (preferredService) {
    const match = withIls.find((row) => String(row.serviceName).toLowerCase() === String(preferredService).toLowerCase());
    if (match) return match;
  }
  return withIls[0];
}

async function quoteCartShipping(lines, countryCode = 'IL') {
  const quotedLines = [];
  for (const line of lines) {
    const provider = String(line.fulfillmentProvider || line.supplier || '').trim().toLowerCase();
    let quote;
    if (provider === 'cj') {
      quote = await quoteCjFreight({
        variantId: line.supplierSkuId,
        qty: line.qty,
        countryCode,
        shipFromCountry: line.supplierShipFromCountry || 'CN',
        preferredService: line.fulfillmentLogisticName || null
      });
    } else {
      if (!line.supplierProductId) {
        const error = new Error(`supplier_product_missing_${line.id}`);
        error.code = 'supplier_product_missing';
        throw error;
      }
      quote = await quoteAliExpressFreight({
        productId: line.supplierProductId,
        qty: line.qty,
        countryCode,
        shipFromCountry: line.supplierShipFromCountry || 'CN'
      });
    }
    quotedLines.push({
      id: line.id,
      provider: provider || 'aliexpress',
      qty: line.qty,
      cost: quote.amountIls,
      currency: 'ILS',
      supplierAmount: quote.amount,
      supplierCurrency: quote.currency,
      serviceName: quote.serviceName,
      estimatedDeliveryTime: quote.estimatedDeliveryTime
    });
  }

  const total = Number(quotedLines.reduce((sum, line) => sum + Number(line.cost || 0), 0).toFixed(2));
  return {
    status: 'quoted',
    total,
    currency: 'ILS',
    quotedAt: new Date().toISOString(),
    lines: quotedLines
  };
}

module.exports = {
  FREIGHT_PATH,
  FREIGHT_METHOD,
  convertToIls,
  quoteAliExpressFreight,
  quoteCjFreight,
  quoteCartShipping
};
