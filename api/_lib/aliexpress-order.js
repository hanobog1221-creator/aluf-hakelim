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

module.exports = { buildPlaceOrderRequest, safePreview };
