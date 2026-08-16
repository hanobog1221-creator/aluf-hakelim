// Server-side supplier mapping. Never trust supplier details from the browser.
// Mark readyForFulfillment=true only after the exact AliExpress SKU is verified.

const SUPPLIERS = {
  socket: {
    storeProductId: 'socket',
    supplier: 'aliexpress',
    sourceUrl: 'https://www.aliexpress.com/item/1005012906553288.html',
    variantLabel: null,
    productId: '1005012906553288',
    skuId: null,
    readyForFulfillment: false
  },
  ratchet: {
    storeProductId: 'ratchet',
    supplier: 'aliexpress',
    sourceUrl: 'https://www.aliexpress.com/item/1005012879937902.html',
    variantLabel: 'Body only / no battery',
    productId: '1005012879937902',
    skuId: null,
    readyForFulfillment: false
  },
  impact: {
    storeProductId: 'impact',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c4qlMwlt',
    variantLabel: 'Body only / no battery',
    productId: '1005010616492119',
    skuId: null,
    readyForFulfillment: false
  },
  washer: {
    storeProductId: 'washer',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c3WtbAqT',
    variantLabel: null,
    productId: '1005012629074137',
    skuId: null,
    readyForFulfillment: false
  },
  battery588: {
    storeProductId: 'battery588',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c3mUoejd',
    variantLabel: 'Battery 1 Charger 1',
    productId: '1005008055230578',
    skuId: null,
    readyForFulfillment: false
  }
};

function getSupplierMapping(storeProductId) {
  return SUPPLIERS[String(storeProductId || '')] || null;
}

module.exports = { SUPPLIERS, getSupplierMapping };
