function clean(value, max = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function israelPhoneParts(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00972')) digits = digits.slice(5);
  else if (digits.startsWith('972')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 10) throw new Error('invalid_israel_phone');
  return { phoneCountry: '+972', mobileNo: digits };
}

function shippingLineMap(order, shippingQuoteOverride = null) {
  const source = shippingQuoteOverride || order?.shipping_quote || null;
  const lines = Array.isArray(source?.lines) ? source.lines : [];
  return new Map(lines.map((line) => [String(line.id || ''), line]));
}

function buildPlaceOrderRequest(order, shippingQuoteOverride = null) {
  const customer = order?.customer || {};
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) throw new Error('no_items');

  const fullName = clean(customer.fullName, 80);
  const city = clean(customer.city, 80);
  const street = clean(customer.street, 100);
  const houseNumber = clean(customer.houseNumber, 20);
  if (!fullName || !city || !street || !houseNumber) throw new Error('shipping_address_incomplete');

  const phone = israelPhoneParts(customer.phone);
  const address = `${street} ${houseNumber}`.trim();
  const apartment = clean(customer.apartment, 20);
  const zip = clean(customer.postalCode, 20);
  const shippingByProduct = shippingLineMap(order, shippingQuoteOverride);

  const productItems = items.map((item) => {
    const productId = String(item.supplierProductId || '');
    const skuAttr = String(item.supplierSkuId || '');
    const qty = Number(item.qty || 0);
    if (!/^\d{8,20}$/.test(productId)) throw new Error(`invalid_supplier_product_id_${item.id}`);
    if (!skuAttr || skuAttr.length > 500) throw new Error(`invalid_supplier_sku_${item.id}`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error(`invalid_supplier_quantity_${item.id}`);

    const shipping = shippingByProduct.get(String(item.id));
    const serviceName = clean(shipping?.serviceName, 120);
    if (!serviceName) throw new Error(`shipping_service_missing_${item.id}`);

    return {
      product_count: qty,
      product_id: Number(productId),
      sku_attr: skuAttr,
      logistics_service_name: serviceName
    };
  });

  return {
    logistics_address: {
      address,
      ...(apartment ? { address2: `Apartment ${apartment}` } : {}),
      city,
      contact_person: fullName,
      country: 'IL',
      full_name: fullName,
      locale: 'en_US',
      mobile_no: phone.mobileNo,
      phone_country: phone.phoneCountry,
      ...(zip ? { zip } : {})
    },
    product_items: productItems
  };
}

function supplierGroupKey(item) {
  const supplierId = String(item?.supplierId || '').trim();
  if (supplierId) return { key: `supplier:${supplierId}`, supplierId };
  const productId = String(item?.supplierProductId || '').trim();
  if (!/^\d{8,20}$/.test(productId)) throw new Error(`supplier_identity_missing_${item?.id || 'item'}`);
  // When the seller identity is unavailable, never combine different products.
  // A per-product request is safer than accidentally mixing separate AliExpress sellers.
  return { key: `product:${productId}`, supplierId: `product:${productId}` };
}

function buildPlaceOrderRequests(order, shippingQuoteOverride = null) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const groups = new Map();
  for (const item of items) {
    const identity = supplierGroupKey(item);
    if (!groups.has(identity.key)) groups.set(identity.key, { supplierId: identity.supplierId, items: [] });
    groups.get(identity.key).items.push(item);
  }
  return [...groups.values()].map((group) => ({
    supplierId: group.supplierId,
    request: buildPlaceOrderRequest({ ...order, items: group.items }, shippingQuoteOverride)
  }));
}

function safePreview(request) {
  return {
    logistics_address: {
      country: request.logistics_address.country,
      city: request.logistics_address.city,
      addressPresent: Boolean(request.logistics_address.address),
      zipPresent: Boolean(request.logistics_address.zip),
      phonePresent: Boolean(request.logistics_address.mobile_no),
      recipientPresent: Boolean(request.logistics_address.full_name)
    },
    product_items: request.product_items.map((item) => ({
      product_id: item.product_id,
      sku_attr: item.sku_attr,
      product_count: item.product_count,
      logistics_service_name: item.logistics_service_name
    }))
  };
}

function arrayify(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeOrderIds(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'number')
    ? value.number
    : value;
  return [...new Set(arrayify(raw)
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d{5,30}$/.test(id)))];
}

function parsePlaceOrderResponse(json) {
  const root = json?.aliexpress_trade_buy_placeorder_response || json?.aliexpressTradeBuyPlaceorderResponse || null;
  const result = root?.result || null;
  const apiError = json?.error_response || json?.errorResponse || null;

  if (result) {
    const orderIds = normalizeOrderIds(result.order_list ?? result.orderList);
    const success = result.is_success === true || String(result.is_success).toLowerCase() === 'true';
    const errorCode = clean(result.error_code ?? result.errorCode, 120);
    const errorMessage = clean(result.error_msg ?? result.errorMsg, 500);

    if (success && orderIds.length) {
      return { outcome: 'created', orderIds, errorCode, errorMessage, shouldReconcile: false };
    }
    if (errorCode === 'REPEATED_ORDER_ERROR') {
      return { outcome: 'ambiguous', orderIds, errorCode, errorMessage, shouldReconcile: true };
    }
    if (success && !orderIds.length) {
      return {
        outcome: 'ambiguous',
        orderIds: [],
        errorCode: errorCode || 'success_without_order_ids',
        errorMessage,
        shouldReconcile: true
      };
    }
    return {
      outcome: 'failed',
      orderIds,
      errorCode: errorCode || 'place_order_failed',
      errorMessage,
      shouldReconcile: false
    };
  }

  if (apiError) {
    const errorCode = clean(apiError.sub_code ?? apiError.subCode ?? apiError.code, 120) || 'api_error';
    const errorMessage = clean(apiError.sub_msg ?? apiError.subMsg ?? apiError.msg, 500);
    const repeated = errorCode === 'REPEATED_ORDER_ERROR' || errorMessage === 'REPEATED_ORDER_ERROR';
    return {
      outcome: repeated ? 'ambiguous' : 'failed',
      orderIds: [],
      errorCode,
      errorMessage,
      shouldReconcile: repeated
    };
  }

  return {
    outcome: 'ambiguous',
    orderIds: [],
    errorCode: 'unexpected_place_order_response',
    errorMessage: null,
    shouldReconcile: true
  };
}

module.exports = {
  buildPlaceOrderRequest,
  buildPlaceOrderRequests,
  safePreview,
  parsePlaceOrderResponse,
  normalizeOrderIds
};
