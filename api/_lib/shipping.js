const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken } = require('./aliexpress');

const FREIGHT_PATH = '/logistics/buyer/freight/calculate';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

async function convertToIls(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('invalid_shipping_amount');
  const code = cleanCurrency(currency);
  if (!code) throw new Error('invalid_shipping_currency');
  if (code === 'ILS') return Number(numeric.toFixed(2));

  const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(code)}&to=ILS`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`fx_unavailable_${response.status}`);
  const data = await response.json();
  const rate = Number(data?.rates?.ILS);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('fx_rate_missing');
  return Number((numeric * rate).toFixed(2));
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

async function quoteAliExpressFreight({ productId, qty, countryCode = 'IL', shipFromCountry = 'CN' }) {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  if (!/^\d{8,20}$/.test(String(productId || ''))) throw new Error('bad_supplier_product_id');

  const accessToken = await getValidAccessToken();
  const dto = {
    country_code: String(countryCode || 'IL').toUpperCase(),
    product_id: Number(productId),
    product_num: Math.max(1, Math.min(20, Math.floor(Number(qty || 1)))),
    send_goods_country_code: String(shipFromCountry || 'CN').toUpperCase()
  };

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

  const withIls = [];
  for (const option of options) {
    const ils = await convertToIls(option.amount, option.currency);
    withIls.push({ ...option, amountIls: ils });
  }
  withIls.sort((a, b) => a.amountIls - b.amountIls);
  return withIls[0];
}

async function quoteCartShipping(lines, countryCode = 'IL') {
  const quotedLines = [];
  for (const line of lines) {
    if (!line.supplierProductId) {
      const error = new Error(`supplier_product_missing_${line.id}`);
      error.code = 'supplier_product_missing';
      throw error;
    }
    const quote = await quoteAliExpressFreight({
      productId: line.supplierProductId,
      qty: line.qty,
      countryCode,
      shipFromCountry: line.supplierShipFromCountry || 'CN'
    });
    quotedLines.push({
      id: line.id,
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
  convertToIls,
  quoteAliExpressFreight,
  quoteCartShipping
};
