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
  'cj-detail-brush': {
    storeProductId: 'cj-detail-brush', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/car-detail-brush-soft-brush-interior-cleaning-p-1796519066690134016.html',
    variantLabel: 'DT Short Black', productId: '1796519066690134016', skuId: 'CJYD205093001AZ', readyForFulfillment: false
  },
  'cj-car-mop': {
    storeProductId: 'cj-car-mop', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/car-special-retractable-car-wash-mop-p-2507300541361601000.html',
    variantLabel: 'Retractable / Product A', productId: '2507300541361601000', skuId: 'CJYD244347501AZ', readyForFulfillment: false
  },
  'cj-magnetic-ring': {
    storeProductId: 'cj-magnetic-ring', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/batch-head-magnetic-ring-strong-magnetic-ring-p-03AE091B-C975-45DC-8CCB-8D99E169DD5B.html',
    variantLabel: 'Black', productId: '03AE091B-C975-45DC-8CCB-8D99E169DD5B', skuId: 'CJJZGJGJ00295-Black', readyForFulfillment: false
  },
  'cj-k5-bits': {
    storeProductId: 'cj-k5-bits', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/k5-anti-skid-impact-resistance-bits-set-strong-magnetic-property-high-hardness-p-2505280520041627200.html',
    variantLabel: 'Thread Bit / PH2 / 25-90mm', productId: '2505280520041627200', skuId: 'CJYD238740101AZ', readyForFulfillment: false
  },
  'cj-microfiber-towel': {
    storeProductId: 'cj-microfiber-towel', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/coral-fleece-car-cleaning-cloth-fiber-rag-thickened-absorbent-two-color-double-sided-car-towel-p-2508140916071605900.html',
    variantLabel: '600gsm Yellow / 30x60cm / 1PC', productId: '2508140916071605900', skuId: 'CJYD245635902BY', readyForFulfillment: false
  },
  'cj-wash-mitt': {
    storeProductId: 'cj-wash-mitt', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/bear-paw-car-cleaning-supplies-p-C31D17AE-D6E6-451C-AB01-21C1C78E3DF4.html',
    variantLabel: 'Gray and orange / XXL', productId: 'C31D17AE-D6E6-451C-AB01-21C1C78E3DF4', skuId: 'CJQCGJQC00049-Gray and orange-XXL', readyForFulfillment: false
  },
  'cj-silicone-squeegee': {
    storeProductId: 'cj-silicone-squeegee', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/car-wash-wiper-glass-car-silicone-snow-scraper-beef-tendon-wiper-car-film-cleaning-tool-car-cleaning-tool-p-2408221054311606600.html',
    variantLabel: 'Blue / 1PCS', productId: '2408221054311606600', skuId: 'CJYD211764802BY', readyForFulfillment: false
  },
  'cj-tire-gauge': {
    storeProductId: 'cj-tire-gauge', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/tire-pressure-gauge-p-2D644825-4547-4EA6-9C8D-22E3DC3CFFE8.html',
    variantLabel: 'Blue / basic gauge', productId: '2D644825-4547-4EA6-9C8D-22E3DC3CFFE8', skuId: 'CJQCQCQC00899-Blue', readyForFulfillment: false
  },
  'cj-phone-holder': {
    storeProductId: 'cj-phone-holder', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/car-phone-holder-long-rod-telescopic-car-dashboard-suction-cup-type-p-F49539CA-E1AC-459B-AE22-E2A28BAE6939.html',
    variantLabel: 'Black / single holder', productId: 'F49539CA-E1AC-459B-AE22-E2A28BAE6939', skuId: 'CJQCQCQC00072', readyForFulfillment: false
  },
  'cj-kw310-obd': {
    storeProductId: 'cj-kw310-obd', supplier: 'cj',
    sourceUrl: 'https://cjdropshipping.com/product/kw310-car-diagnostic-scanner-scanner-barcode-reader-tool-p-1405434203297943552.html',
    variantLabel: 'KW310 Black', productId: '1405434203297943552', skuId: 'CJQC117858301AZ', readyForFulfillment: false
  }
};

function getSupplierMapping(storeProductId) {
  return SUPPLIERS[String(storeProductId || '')] || null;
}

module.exports = { SUPPLIERS, getSupplierMapping };
