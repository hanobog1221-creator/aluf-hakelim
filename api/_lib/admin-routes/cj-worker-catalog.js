const { serverConfig, serverHeaders } = require('../supabase-server');
const { ensureAccessToken, CJ_BASE } = require('../cj');
const { convertToIls } = require('../shipping');
const { requireWorker } = require('../cj-worker-auth');
const { recordSupplierOfferSafely } = require('../supplier-offers-store');
const { pricingPolicy } = require('../pricing-engine');
const { DEFAULT_MINIMUM_PROFIT_ILS, DEFAULT_TAX_RESERVE_PERCENT, DEFAULT_INSURANCE_RESERVE_PERCENT, pricingForOffer } = require('../supplier-optimizer');
const { SUPPLIERS } = require('../suppliers');

const DISCOVERY_TARGET = 100;
const DISCOVERY_BATCH = 6;
const DISCOVERY_MAX_SELLING_PRICE_ILS = 149.90;
const DISCOVERY_MAX_LANDED_COST_ILS = 75;
const DISCOVERY_SEARCHES = [
  { keyword: 'car detailing brush', label: 'מברשת דיטיילינג לרכב', categories: ['car', 'cleaning'], kind: 'ניקוי ודיטיילינג · מברשות' },
  { keyword: 'microfiber car towel', label: 'מגבת מיקרופייבר לרכב', categories: ['car', 'cleaning'], kind: 'ניקוי ודיטיילינג · ייבוש והברקה' },
  { keyword: 'car cleaning tool', label: 'אביזר מקצועי לניקוי הרכב', categories: ['car', 'cleaning'], kind: 'ניקוי ודיטיילינג · אביזרים' },
  { keyword: 'trim removal tool', label: 'כלי לפירוק דיפוני רכב', categories: ['car', 'hand'], kind: 'כלי רכב · פירוק והרכבה' },
  { keyword: 'tire repair tool', label: 'כלי תחזוקה לצמיגים', categories: ['car', 'maintenance'], kind: 'תחזוקת רכב · צמיגים' },
  { keyword: 'OBD2 scanner', label: 'סורק תקלות OBD2', categories: ['car', 'diagnostics'], kind: 'אבחון ותחזוקת רכב · OBD2' },
  { keyword: 'socket wrench tool', label: 'אביזר לבוקסות וראצ׳ט', categories: ['hand', 'maintenance'], kind: 'כלי עבודה · בוקסות וראצ׳טים' },
  { keyword: 'drill bit set', label: 'סט מקדחים לעבודה מדויקת', categories: ['power', 'hand'], kind: 'כלי עבודה · מקדחים' },
  { keyword: 'screwdriver bit set', label: 'סט ביטים למברגה', categories: ['power', 'hand'], kind: 'כלי עבודה · ביטים' },
  { keyword: 'magnetic tool gadget', label: 'גאדג׳ט מגנטי לכלי עבודה', categories: ['gadgets', 'hand'], kind: 'גאדג׳טים לכלי עבודה' },
  { keyword: 'car phone holder', label: 'מעמד טלפון לרכב', categories: ['car', 'gadgets'], kind: 'אביזרי רכב · מעמדים' }
];
const BLOCKED_DISCOVERY_WORDS = /\b(battery|charger|lithium|li-ion|li ion|spray|liquid|wax|polish|chemical|pesticide|medical|baby|makita|dewalt|bosch|milwaukee|jack stand|seat belt)\b/i;
const KNOWN_CJ_CATALOG = [
  { id: 'cj-detail-brush', search: 'car detailing brush', name: 'מברשת דיטיילינג רכה לניקוי פנים הרכב', image: '/assets/products/cj-detail-brush.jpg', categories: ['car','cleaning','maintenance'], kind: 'ניקוי ודיטיילינג · פנים הרכב', badge: 'קלת משקל', description: 'מברשת ניילון רכה לניקוי פתחי מיזוג, לוח מחוונים, כפתורים ואזורים צרים בלי להשאיר שריטות.', specs: ['סיבי ניילון רכים','מתאימה לפתחי מיזוג ולחריצים','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-car-mop', search: 'car wash mop', name: 'מגב מיקרופייבר טלסקופי לניקוי הרכב', image: '/assets/products/cj-car-mop.jpg', categories: ['car','cleaning'], kind: 'ניקוי ודיטיילינג · שטיפת רכב', badge: 'טלסקופי', description: 'מגב ננו־פייבר נשלף להסרת אבק וניקוי מרכב הרכב, עם ידית טלסקופית.', specs: ['ידית טלסקופית','ראש ננו־פייבר','מתאים לניקוי יבש או לח','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-magnetic-ring', search: 'magnetic bit holder', name: 'טבעת מגנטית חזקה לביטים 1/4 אינץ׳', image: '/assets/products/cj-magnetic-ring.jpg', categories: ['hand','gadgets','maintenance'], kind: 'גאדג׳טים לכלים · אביזרי מברגה', badge: 'מגנטית', description: 'טבעת מתכת מגנטית שמתלבשת על ביט 6.35 מ״מ ומחזיקה את הבורג במקום בזמן העבודה.', specs: ['מתאימה לביטים 6.35 מ״מ','אחיזה מגנטית חזקה','מבנה מתכתי','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-k5-bits', name: 'סט 5 ביטים PH2 מגנטיים עמידים לאימפקט', image: '/assets/products/cj-k5-bits.jpg', categories: ['hand','power','gadgets'], kind: 'כלי עבודה · ביטים למברגה', badge: '5 יחידות', description: 'סט ביטים PH2 באורכים שונים עם מבנה נגד החלקה, מיועד לעבודה עם מברגות ואימפקט.', specs: ['5 ביטים PH2','מתאים למברגות אימפקט','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-microfiber-towel', name: 'מגבת מיקרופייבר עבה לרכב 30×60 ס״מ', image: '/assets/products/cj-microfiber-towel.jpg', categories: ['car','cleaning'], kind: 'ניקוי ודיטיילינג · ייבוש והברקה', badge: '600GSM', description: 'מגבת דו־צדדית סופגת לניקוי, ייבוש והברקת הרכב, עם שוליים תפורים לשימוש חוזר.', specs: ['מידה 30×60 ס״מ','בד בצפיפות גבוהה','מתאימה לשטיפה ולהברקה','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-wash-mitt', search: 'car wash mitt', name: 'כפפת שטיפה דו־צדדית רכה לרכב', image: '/assets/products/cj-wash-mitt.jpg', categories: ['car','cleaning'], kind: 'ניקוי ודיטיילינג · שטיפת רכב', badge: 'דו־צדדית', description: 'כפפת קורל־פליס רכה עם אחיזת אגודל, להסרת אבק ולכלוך בלי לפגוע בצבע הרכב.', specs: ['בד רך וסופג','מתאימה לשימוש חוזר','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-silicone-squeegee', search: 'silicone car squeegee', name: 'מגב סיליקון 30 ס״מ לחלונות ולמרכב', image: '/assets/products/cj-silicone-squeegee.jpg', categories: ['car','cleaning'], kind: 'ניקוי ודיטיילינג · חלונות', badge: 'אוניברסלי', description: 'מגב סיליקון גמיש להסרת מים מחלונות ומשטחי הרכב לאחר שטיפה.', specs: ['רוחב כ־30 ס״מ','חומר סיליקון גמיש','מתאים לחלונות ולמרכב','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-tire-gauge', search: 'pencil tire pressure gauge', name: 'מד לחץ אוויר לצמיגים עד 150 PSI', image: '/assets/products/cj-tire-gauge.jpg', categories: ['car','diagnostics','gadgets'], kind: 'אבחון ותחזוקת רכב · צמיגים', badge: 'ללא סוללה', description: 'מד לחץ קומפקטי לבדיקת לחץ בצמיגי רכב, אופנוע ואופניים.', specs: ['טווח עד 150 PSI לפי הדגם','ללא סוללת ליתיום','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-phone-holder', name: 'מעמד טלסקופי לרכב עם זרוע מסתובבת 360°', image: '/assets/products/cj-phone-holder.jpg', categories: ['car','gadgets'], kind: 'אביזרי רכב · מעמדים', badge: '360°', description: 'מעמד טלפון עם זרוע טלסקופית וכוס יניקה ללוח המחוונים או לשמשה.', specs: ['סיבוב 360 מעלות','זרוע טלסקופית','כוס יניקה נשטפת','וריאנט מדויק ומשלוח לישראל באימות'] },
  { id: 'cj-kw310-obd', name: 'סורק תקלות OBD2 דגם KW310 לרכב 12V', image: '/assets/products/cj-kw310-obd.jpg', categories: ['car','diagnostics','gadgets'], kind: 'אבחון ותחזוקת רכב · OBD2', badge: 'כלי אבחון', badgeClass: 'red', description: 'קורא תקלות קומפקטי לרכבי 12V תואמי OBD2, להצגת קודי תקלה בסיסיים ומידע מהמחשב.', specs: ['חיבור OBD2','מיועד לרכבי 12V תואמים','יש לבדוק תאימות לדגם הרכב לפני הזמנה'] }
];

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let lastCjRequestAt = 0;

async function cj(path, { method = 'GET', body } = {}) {
  const wait = Math.max(0, 1150 - (Date.now() - lastCjRequestAt));
  if (wait) await sleep(wait);
  lastCjRequestAt = Date.now();
  const token = await ensureAccessToken();
  const headers = { Accept: 'application/json', 'CJ-Access-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${CJ_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  const code = Number(json?.code);
  if (!response.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0, 200].includes(code))) {
    throw new Error(`cj_${json?.code || response.status}_${clean(json?.message || 'failed', 180)}`);
  }
  return json;
}

async function dbGet(path) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: serverHeaders() });
  if (!response.ok) throw new Error(`db_get_${response.status}`);
  return response.json();
}

async function patch(table, filter, data) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`${table}_patch_${response.status}_${(await response.text()).slice(0, 180)}`);
  return (await response.json())[0] || null;
}

async function upsertProduct(data) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/products?on_conflict=id`, {
    method: 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`product_upsert_${response.status}_${(await response.text()).slice(0, 180)}`);
  return (await response.json())[0] || null;
}

function inventoryRows(detail) { return Array.isArray(detail?.inventories) ? detail.inventories : []; }
function inventoryTotal(detail) { return inventoryRows(detail).reduce((sum, row) => sum + (Number(row?.totalInventory ?? row?.totalInventoryNum) || 0), 0); }
function originCountry(detail) {
  const rows = inventoryRows(detail);
  const china = rows.find((row) => String(row?.countryCode || '').toUpperCase() === 'CN' && (Number(row?.totalInventory ?? row?.totalInventoryNum) || 0) > 0);
  if (china) return 'CN';
  return clean(rows.find((row) => (Number(row?.totalInventory ?? row?.totalInventoryNum) || 0) > 0)?.countryCode || 'CN', 2).toUpperCase();
}
function chooseFreight(rows, preferred) {
  const valid = (Array.isArray(rows) ? rows : []).filter((row) => Number.isFinite(Number(row?.logisticPrice)) && Number(row.logisticPrice) >= 0);
  const match = preferred && valid.find((row) => clean(row?.logisticName, 120).toLowerCase() === clean(preferred, 120).toLowerCase());
  if (match) return match;
  valid.sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice));
  return valid[0] || null;
}
function minimumProfit(product, settings) {
  const configured = product.minimum_profit == null ? Number(settings.minimum_profit_ils) : Number(product.minimum_profit);
  return Math.max(DEFAULT_MINIMUM_PROFIT_ILS, Number.isFinite(configured) ? configured : DEFAULT_MINIMUM_PROFIT_ILS);
}
function pricingOptions(settings) {
  const policy = pricingPolicy();
  return {
    paymentFeePercent: Number(settings.pricing_fee_percent || policy.processingFeeRate * 100),
    paymentFeeFixedIls: Number(settings.pricing_fee_fixed_ils || 0), reserveIls: Number(settings.pricing_reserve_ils || 0),
    taxReservePercent: Number(settings.pricing_tax_reserve_percent ?? DEFAULT_TAX_RESERVE_PERCENT),
    insuranceReservePercent: Number(settings.pricing_insurance_reserve_percent ?? DEFAULT_INSURANCE_RESERVE_PERCENT),
    vatRate: policy.vatRate, serviceFeePercent: policy.serviceFeeRate * 100,
    supplierBufferPercent: policy.supplierBufferRate * 100, advertisingCostIls: policy.advertisingCostIls,
    cancellationReserveIls: policy.cancellationRate * policy.refundFeeIls
  };
}

async function getVariant(variantId) {
  const json = await cj(`/product/variant/queryByVid?vid=${encodeURIComponent(variantId)}&features=enable_inventory`);
  return json.data && typeof json.data === 'object' ? json.data : null;
}
async function getFreight(variantId, origin) {
  const json = await cj('/logistic/freightCalculate', { method: 'POST', body: { startCountryCode: origin, endCountryCode: 'IL', products: [{ quantity: 1, vid: String(variantId) }] } });
  return Array.isArray(json.data) ? json.data : [];
}

function listRows(json) {
  const data = json?.data;
  if (Array.isArray(data)) return data;
  for (const key of ['content', 'list', 'products', 'productList']) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function productIdentity(row) { return clean(row?.pid || row?.productId || row?.id, 180); }
function productTitle(row) { return clean(row?.productNameEn || row?.productName || row?.nameEn || row?.name, 300); }
function productImage(row) { return clean(row?.variantImage || row?.productImage || row?.bigImage || row?.image || row?.productImageUrl, 2000); }
function imageProxyUrl(url) { return url ? `/api/cj-image?url=${encodeURIComponent(url)}` : null; }
function safeProductId(pid) { return `cj-auto-${String(pid).replace(/[^a-z0-9-]/gi, '').slice(0, 64)}`; }

async function searchProducts(search, page) {
  const query = new URLSearchParams({ page: String(page), size: '20', keyWord: search.keyword, countryCode: 'CN', endSellPrice: '20' });
  return listRows(await cj(`/product/listV2?${query.toString()}`));
}
async function variantsForProduct(pid) {
  const json = await cj(`/product/variant/query?pid=${encodeURIComponent(pid)}`);
  return Array.isArray(json.data) ? json.data : (Array.isArray(json.data?.list) ? json.data.list : []);
}
async function variantFromSku(productId, sku) {
  const rows = await variantsForProduct(productId);
  return rows.find((row) => clean(row?.variantSku, 180) === clean(sku, 180)) || null;
}

async function ensureKnownCatalogProducts(existingProducts, settings) {
  const existing = new Map(existingProducts.map((product) => [String(product.id), product]));
  const usedSupplierIds = new Set(existingProducts.map((product) => String(product.fulfillment_product_id || product.supplier_product_id || '')).filter(Boolean));
  const results = [];
  let repairsRemaining = 2;
  let repairAttempts = 0;
  for (let index = 0; index < KNOWN_CJ_CATALOG.length; index += 1) {
    const seed = KNOWN_CJ_CATALOG[index], mapping = SUPPLIERS[seed.id], current = existing.get(seed.id);
    if (!mapping) { results.push({ id: seed.id, error: 'supplier_mapping_missing' }); continue; }
    let variant = null;
    let selectedProductId = clean(current?.fulfillment_product_id || mapping.productId, 180);
    let selectedSku = clean(current?.fulfillment_sku || mapping.skuId, 180);
    let selectedUrl = current?.supplier_url || mapping.sourceUrl;
    let selectedVariantLabel = current?.variant_label || mapping.variantLabel;
    try { variant = await variantFromSku(selectedProductId, selectedSku); }
    catch (error) { results.push({ id: seed.id, error: clean(error.message, 160) }); }
    if (variant?.vid && current?.fulfillment_variant_id && clean(variant.vid, 160) === clean(current.fulfillment_variant_id, 160)) {
      results.push({ id: seed.id, seeded: false, mapped: true });
      continue;
    }
    if (!variant?.vid && repairsRemaining > 0 && seed.search) {
      repairsRemaining -= 1;
      repairAttempts += 1;
      try {
        const replacement = await findKnownReplacement(seed, usedSupplierIds);
        if (replacement) {
          variant = replacement.quote.variant;
          selectedProductId = replacement.productId;
          selectedSku = replacement.quote.variantSku;
          selectedUrl = `https://cjdropshipping.com/product/-p-${selectedProductId}.html`;
          selectedVariantLabel = clean(variant.variantNameEn || variant.variantKey || selectedSku, 300);
          usedSupplierIds.add(selectedProductId);
        }
      } catch (error) { results.push({ id: seed.id, error: `replacement_${clean(error.message, 140)}` }); }
    }
    const identity = variant?.vid ? {
      fulfillment_product_id: selectedProductId,
      fulfillment_variant_id: clean(variant.vid, 160),
      fulfillment_sku: selectedSku,
      fulfillment_provider_status: 'quote_ready'
    } : {
      fulfillment_product_id: selectedProductId,
      fulfillment_variant_id: null,
      fulfillment_sku: selectedSku,
      fulfillment_provider_status: 'variant_lookup_pending'
    };
    if (current) {
      await patch('products', `id=eq.${encodeURIComponent(seed.id)}`, { supplier: 'cj', supplier_url: selectedUrl, supplier_product_id: selectedProductId, supplier_sku_id: variant?.vid || null, variant_label: selectedVariantLabel, fulfillment_provider: 'cj', fulfillment_ready: false, minimum_profit: minimumProfit(current, settings), ...identity });
      results.push({ id: seed.id, seeded: false, mapped: Boolean(variant?.vid) });
      continue;
    }
    const product = await upsertProduct({
      id: seed.id, name: seed.name, selling_price: 0.90, old_price: null, currency: 'ILS', active: true,
      image_url: seed.image, categories: seed.categories, kind: seed.kind, badge: seed.badge, badge_class: seed.badgeClass || '',
      description: seed.description, specs: seed.specs, sort_order: 200 + index, max_order_quantity: 20,
      supplier: 'cj', supplier_url: selectedUrl, supplier_product_id: selectedProductId, supplier_sku_id: variant?.vid || null,
      variant_label: selectedVariantLabel, fulfillment_provider: 'cj', fulfillment_ready: false,
      minimum_profit: minimumProfit({}, settings), ...identity
    });
    existing.set(seed.id, product);
    results.push({ id: seed.id, seeded: true, mapped: Boolean(variant?.vid) });
  }
  return { results, repairAttempts };
}
function cheapestVariants(rows, limit = 2) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const price = Number(row?.variantSellPrice), vid = clean(row?.vid, 160), sku = clean(row?.variantSku, 180);
    return vid && sku && Number.isFinite(price) && price >= 0;
  }).sort((a, b) => Number(a.variantSellPrice) - Number(b.variantSellPrice)).slice(0, limit);
}
async function bestVariantQuote(rows) {
  const quotes = [];
  for (const variant of cheapestVariants(rows)) {
    const variantId = clean(variant.vid, 160), variantSku = clean(variant.variantSku, 180);
    const detail = await getVariant(variantId);
    if (!detail) continue;
    const origin = originCountry(detail), stock = inventoryTotal(detail);
    if (stock <= 0) continue;
    const freight = chooseFreight(await getFreight(variantId, origin));
    if (!freight) continue;
    const productPriceUsd = Number(detail.variantSellPrice), shippingPriceUsd = Number(freight.logisticPrice);
    if (!Number.isFinite(productPriceUsd) || productPriceUsd < 0 || !Number.isFinite(shippingPriceUsd) || shippingPriceUsd < 0) continue;
    const productPriceIls = await convertToIls(productPriceUsd, 'USD'), shippingPriceIls = await convertToIls(shippingPriceUsd, 'USD');
    quotes.push({ variant, variantId, variantSku, detail, origin, stock, freight, productPriceUsd, shippingPriceUsd, productPriceIls, shippingPriceIls, landedCost: Number((productPriceIls + shippingPriceIls).toFixed(2)) });
  }
  quotes.sort((a, b) => a.landedCost - b.landedCost);
  return quotes[0] || null;
}

async function findKnownReplacement(seed, usedSupplierIds) {
  const rows = await searchProducts({ keyword: seed.search }, 1);
  for (const row of rows.slice(0, 3)) {
    const productId = productIdentity(row), title = productTitle(row);
    if (!productId || usedSupplierIds.has(productId) || BLOCKED_DISCOVERY_WORDS.test(title) || BLOCKED_DISCOVERY_WORDS.test(JSON.stringify(row))) continue;
    const quote = await bestVariantQuote(await variantsForProduct(productId));
    if (quote && quote.landedCost <= DISCOVERY_MAX_LANDED_COST_ILS) return { productId, quote };
  }
  return null;
}

async function discoverProducts(products, settings, limit = DISCOVERY_BATCH) {
  const existingSupplierIds = new Set(products.map((product) => String(product.supplier_product_id || product.fulfillment_product_id || '')).filter(Boolean));
  const existingIds = new Set(products.map((product) => String(product.id)));
  const added = [], rejected = [];
  const searchOffset = products.length % DISCOVERY_SEARCHES.length;
  for (let searchIndex = 0; searchIndex < DISCOVERY_SEARCHES.length && added.length < limit; searchIndex += 1) {
    const search = DISCOVERY_SEARCHES[(searchOffset + searchIndex) % DISCOVERY_SEARCHES.length];
    let rows = [];
    try { rows = await searchProducts(search, 1 + Math.floor(products.length / 80) % 5); }
    catch (error) { rejected.push({ keyword: search.keyword, reason: clean(error.message, 140) }); continue; }
    for (const row of rows) {
      if (added.length >= limit) break;
      const pid = productIdentity(row), title = productTitle(row);
      if (!pid || existingSupplierIds.has(pid) || BLOCKED_DISCOVERY_WORDS.test(title) || BLOCKED_DISCOVERY_WORDS.test(JSON.stringify(row))) continue;
      try {
        const verifiedQuote = await bestVariantQuote(await variantsForProduct(pid));
        if (!verifiedQuote) throw new Error('no_stocked_variant_with_shipping_to_il');
        const variant = verifiedQuote.variant;
        const id = safeProductId(pid);
        if (existingIds.has(id)) continue;
        const sku = clean(variant.variantSku, 180), vid = clean(variant.vid, 160);
        const suffix = clean(sku.slice(-8).replace(/[^a-z0-9]/gi, ''), 8).toUpperCase() || String(added.length + 1);
        const originalImage = productImage(variant) || productImage(row);
        if (!originalImage) throw new Error('image_missing');
        const product = await upsertProduct({
          id, name: `${search.label} – דגם ${suffix}`, selling_price: 0.90, old_price: null, currency: 'ILS', active: false,
          image_url: imageProxyUrl(originalImage), categories: search.categories, kind: search.kind, badge: 'נבדק מול CJ', badge_class: '',
          description: `מוצר שנבחר אוטומטית מקטלוג CJ לאחר בדיקת וריאנט, מלאי ומשלוח לישראל. ${title}`.slice(0, 1200),
          specs: ['וריאנט מדויק מאומת', 'מחיר כולל רזרבות ועמלות', `מק״ט ספק: ${sku}`], sort_order: 1000 + products.length + added.length,
          supplier: 'cj', supplier_url: `https://cjdropshipping.com/product/-p-${pid}.html`, supplier_product_id: pid, supplier_sku_id: vid,
          variant_label: clean(variant.variantNameEn || variant.variantKey || sku, 300), fulfillment_ready: false,
          fulfillment_provider: 'cj', fulfillment_product_id: pid, fulfillment_variant_id: vid, fulfillment_sku: sku,
          fulfillment_provider_status: 'discovery_verifying', minimum_profit: minimumProfit({}, settings)
        });
        const result = await syncProduct(product, settings, null, verifiedQuote);
        if (!result.ready) throw new Error(result.costWithinLimit ? 'profit_or_stock_guard' : 'supplier_cost_above_auto_limit');
        if (result.landedCost > DISCOVERY_MAX_LANDED_COST_ILS) throw new Error('landed_cost_too_high');
        if (result.sellingPrice > DISCOVERY_MAX_SELLING_PRICE_ILS) throw new Error('customer_price_too_high');
        await patch('products', `id=eq.${encodeURIComponent(id)}`, { active: true });
        existingIds.add(id); existingSupplierIds.add(pid);
        added.push({ ...result, name: product.name, keyword: search.keyword });
      } catch (error) {
        rejected.push({ pid, keyword: search.keyword, reason: clean(error.message, 140) });
      }
    }
  }
  return { added, rejected };
}

async function syncProduct(product, settings, job = null, verifiedQuote = null) {
  const variantId = clean(product.fulfillment_variant_id || job?.provider_variant_id, 160);
  const variantSku = clean(product.fulfillment_sku || job?.provider_variant_sku, 180);
  const productId = clean(product.fulfillment_product_id || job?.provider_product_id, 180);
  if (!variantId || !variantSku || !productId) throw new Error('cj_identity_incomplete');
  const quoteMatches = verifiedQuote && verifiedQuote.variantId === variantId && verifiedQuote.variantSku === variantSku;
  const detail = quoteMatches ? verifiedQuote.detail : await getVariant(variantId);
  if (!detail) throw new Error('cj_variant_missing');
  const detailSku = clean(detail.variantSku, 180);
  if (!detailSku || detailSku !== variantSku) throw new Error('cj_variant_sku_mismatch');
  const origin = quoteMatches ? verifiedQuote.origin : originCountry(detail), stock = quoteMatches ? verifiedQuote.stock : inventoryTotal(detail);
  const freight = quoteMatches ? verifiedQuote.freight : chooseFreight(await getFreight(variantId, origin), product.fulfillment_logistic_name || job?.provider_snapshot?.selectedFreight?.logisticName);
  if (!freight) throw new Error('cj_shipping_to_il_unavailable');
  const productPriceUsd = quoteMatches ? verifiedQuote.productPriceUsd : Number(detail.variantSellPrice), shippingPriceUsd = quoteMatches ? verifiedQuote.shippingPriceUsd : Number(freight.logisticPrice);
  if (!Number.isFinite(productPriceUsd) || productPriceUsd < 0) throw new Error('cj_price_missing');
  const productPriceIls = quoteMatches ? verifiedQuote.productPriceIls : await convertToIls(productPriceUsd, 'USD'), shippingPriceIls = quoteMatches ? verifiedQuote.shippingPriceIls : await convertToIls(shippingPriceUsd, 'USD');
  const profitFloor = minimumProfit(product, settings);
  const pricing = pricingForOffer({ provider: 'cj', product_price_ils: productPriceIls, shipping_price_ils: shippingPriceIls }, profitFloor, pricingOptions(settings));
  const now = new Date().toISOString(), landedCost = Number((productPriceIls + shippingPriceIls).toFixed(2));
  const maxCost = product.auto_fulfill_max_cost == null ? null : Number(product.auto_fulfill_max_cost);
  const costWithinLimit = maxCost == null || !Number.isFinite(maxCost) || landedCost <= maxCost;
  const ready = stock > 0 && costWithinLimit && pricing.projectedNetProfit + 0.001 >= profitFloor;
  const snapshot = { source: job ? 'cj_sourcing' : 'cj_sync', cjProductId: productId, cjVariantId: variantId, cjVariantSku: variantSku, variantSellPriceUsd: productPriceUsd, inventory: stock, origin, freight, productPriceIls, shippingPriceIls, pricing, checkedAt: now };

  await patch('products', `id=eq.${encodeURIComponent(product.id)}`, {
    fulfillment_ready: ready, supplier: 'cj', supplier_id: `cj:${productId}`, supplier_product_id: productId,
    supplier_sku_id: variantId, supplier_price: productPriceUsd, supplier_currency: 'USD', supplier_price_ils: productPriceIls,
    supplier_shipping: shippingPriceIls, shipping_currency: 'ILS', supplier_in_stock: stock > 0, supplier_stock: stock,
    supplier_shipping_available: true, supplier_ship_from_country: origin, supplier_sync_error: null, shipping_sync_error: null,
    last_sync_at: now, shipping_last_checked_at: now, selling_price: pricing.sellingPrice, fulfillment_provider: 'cj',
    fulfillment_product_id: productId, fulfillment_variant_id: variantId, fulfillment_sku: variantSku, fulfillment_origin_country: origin,
    fulfillment_logistic_name: clean(freight.logisticName, 120), fulfillment_provider_status: ready ? (job ? 'verified_sourcing' : 'verified_sync') : 'verification_blocked',
    fulfillment_provider_snapshot: snapshot, fulfillment_verified_at: now
  });
  await recordSupplierOfferSafely({
    productId: product.id, provider: 'cj', supplierId: `cj:${productId}`, supplierUrl: product.supplier_url,
    supplierProductId: productId, supplierSkuId: variantId, variantLabel: product.variant_label, productPriceIls, shippingPriceIls,
    inStock: stock > 0, stockQuantity: stock, shippingAvailable: true, equivalenceVerified: true, equivalenceVerifiedAt: now,
    fulfillmentSupported: true, providerSnapshot: { fulfillment_product_id: productId, fulfillment_variant_id: variantId, fulfillment_sku: variantSku, fulfillment_origin_country: origin, fulfillment_logistic_name: clean(freight.logisticName, 120), snapshot },
    lastSyncAt: now, shippingLastCheckedAt: now
  });
  if (job) await patch('product_intake_jobs', `id=eq.${job.id}`, {
    status: ready ? 'published' : 'needs_profit_rule', provider_status: ready ? 'sourcing_verified' : 'needs_profit_rule',
    provider_product_id: productId, provider_variant_id: variantId, provider_variant_sku: variantSku, provider_snapshot: snapshot,
    store_product_id: product.id, last_error: ready ? null : (costWithinLimit ? 'minimum_net_profit_not_met' : 'supplier_cost_above_auto_limit'), processed_at: now
  });
  return { id: product.id, ready, stock, productPriceUsd, productPriceIls, shippingPriceUsd, shippingPriceIls, landedCost, sellingPrice: pricing.sellingPrice, projectedNetProfit: pricing.projectedNetProfit, profitFloor, service: freight.logisticName, costWithinLimit, productId, variantId, variantSku };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!await requireWorker(req, res)) return;
    const settings = (await dbGet('site_settings?id=eq.primary&select=*&limit=1'))[0] || {};
    if (Number(settings.minimum_profit_ils) !== DEFAULT_MINIMUM_PROFIT_ILS) {
      await patch('site_settings', 'id=eq.primary', { minimum_profit_ils: DEFAULT_MINIMUM_PROFIT_ILS });
      await patch('products', 'minimum_profit=eq.25', { minimum_profit: DEFAULT_MINIMUM_PROFIT_ILS }).catch(() => {});
      settings.minimum_profit_ils = DEFAULT_MINIMUM_PROFIT_ILS;
    }
    const allProducts = await dbGet('products?select=*');
    const knownCatalog = await ensureKnownCatalogProducts(allProducts, settings);
    const seeded = knownCatalog.results;
    const products = await dbGet('products?select=*&active=eq.true');
    const byId = new Map(products.map((product) => [String(product.id), product]));
    const jobs = await dbGet('product_intake_jobs?select=*&provider_status=eq.cj_quote_ready'), results = [], synced = new Set();
    for (const job of jobs) {
      const product = byId.get(String(job.store_product_id || ''));
      if (!product) continue;
      try { results.push({ kind: 'finalize', ...await syncProduct(product, settings, job) }); synced.add(String(product.id)); }
      catch (error) { results.push({ kind: 'finalize', id: product.id, error: clean(error.message, 220) }); }
    }
    const refreshable = products.filter((product) => String(product.fulfillment_provider || '').toLowerCase() === 'cj' && product.fulfillment_product_id && product.fulfillment_variant_id && product.fulfillment_sku && !synced.has(String(product.id)));
    for (const product of refreshable) {
      try { results.push({ kind: 'refresh', ...await syncProduct(product, settings) }); }
      catch (error) {
        await patch('products', `id=eq.${encodeURIComponent(product.id)}`, { fulfillment_ready: false, supplier_sync_error: clean(error.message, 300) }).catch(() => {});
        results.push({ kind: 'refresh', id: product.id, error: clean(error.message, 220) });
      }
    }
    const requestedBatch = Math.max(1, Math.min(DISCOVERY_BATCH, Number(req.query?.batch || DISCOVERY_BATCH)));
    const seededCount = seeded.filter((result) => result.seeded).length;
    const discovery = seededCount === 0 && knownCatalog.repairAttempts === 0 && products.filter((product) => product.active === true).length < DISCOVERY_TARGET
      ? await discoverProducts(products, settings, requestedBatch)
      : { added: [], rejected: [] };
    return res.status(200).json({ ok: true, minimumNetProfitIls: Math.max(DEFAULT_MINIMUM_PROFIT_ILS, Number(settings.minimum_profit_ils || DEFAULT_MINIMUM_PROFIT_ILS)), discoveryTarget: DISCOVERY_TARGET, seeded, discovery, results, ready: results.filter((result) => result.ready).length, errors: results.filter((result) => result.error).length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: clean(error.message, 240) });
  }
};
