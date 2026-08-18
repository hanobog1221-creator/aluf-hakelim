const { callTopApi } = require('./aliexpress');
const { quoteAliExpressFreight, convertToIls } = require('./shipping');
const { NO_SKU_ATTR } = require('./aliexpress-order');
const { serverConfig, serverHeaders } = require('./supabase-server');

const PRODUCT_METHOD = 'aliexpress.ds.product.get';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toArray(value) { if (!value) return []; return Array.isArray(value) ? value : [value]; }
function skuRows(result) { return toArray(result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o || result?.aeop_ae_product_s_k_us?.aeop_ae_product_sku || result?.aeop_ae_product_skus?.aeop_ae_product_sku || []); }
function skuProperties(sku) { return toArray(sku?.ae_sku_property_dtos?.ae_sku_property_d_t_o || sku?.aeop_s_k_u_propertys?.aeop_sku_property || sku?.aeop_s_k_u_property_list?.aeop_sku_property || []); }
function skuLabel(sku) { return skuProperties(sku).map((p) => p?.property_value_definition_name || p?.propertyValueDefinitionName || p?.sku_property_value || p?.skuPropertyValue || p?.property_value_id || p?.propertyValueId || '').filter(Boolean).join(' / '); }
function compactShape(sku) {
  const keys = Object.keys(sku || {}).slice(0, 30).sort();
  const propertyKeys = [...new Set(skuProperties(sku).flatMap((p) => Object.keys(p || {})))].slice(0, 30).sort();
  return `${keys.join(',')}|props:${propertyKeys.join(',')}`.slice(0, 220);
}
function skuAttributePath(sku) {
  const directCandidates = [sku?.sku_attr, sku?.skuAttr, sku?.id, sku?.sku_attributes, sku?.skuAttributes];
  for (const candidate of directCandidates) {
    const direct = String(candidate ?? '').trim();
    if (direct && direct.length <= 1000 && /\d+\s*:\s*[^;]+/.test(direct)) return direct;
  }
  const pairs = skuProperties(sku).map((p) => {
    const propertyId = String(p?.sku_property_id ?? p?.skuPropertyId ?? p?.property_id ?? p?.propertyId ?? '').trim();
    const valueId = String(p?.property_value_id ?? p?.propertyValueId ?? p?.sku_property_value_id ?? p?.skuPropertyValueId ?? '').trim();
    const valueName = String(p?.property_value_definition_name ?? p?.propertyValueDefinitionName ?? p?.sku_property_value ?? p?.skuPropertyValue ?? '').trim();
    if (!propertyId || !valueId) return '';
    return `${propertyId}:${valueId}${valueName ? `#${valueName.replace(/[;#]/g, ' ').slice(0, 80)}` : ''}`;
  }).filter(Boolean);
  return pairs.length ? pairs.join(';').slice(0, 1000) : null;
}
function normalizedSku(sku) {
  const properties = skuProperties(sku);
  const stockCountRaw = sku?.sku_available_stock ?? sku?.s_k_u_available_stock ?? sku?.ipm_sku_stock;
  const stockCount = stockCountRaw == null ? null : Number(stockCountRaw);
  const inStock = typeof sku?.sku_stock === 'boolean' ? sku.sku_stock : (Number.isFinite(stockCount) ? stockCount > 0 : null);
  const priceRaw = sku?.offer_sale_price ?? sku?.sku_price;
  const price = priceRaw == null ? null : Number(priceRaw);
  const idRaw = sku?.sku_id ?? sku?.s_k_u_id ?? sku?.skuId ?? sku?.id;
  const attrFieldPresent = Object.prototype.hasOwnProperty.call(sku || {}, 'sku_attr') || Object.prototype.hasOwnProperty.call(sku || {}, 'skuAttr');
  return {
    id: idRaw == null ? null : String(idRaw),
    attr: skuAttributePath(sku),
    attrFieldPresent,
    propertyCount: properties.length,
    label: skuLabel(sku),
    inStock,
    stock: Number.isFinite(stockCount) ? stockCount : null,
    price: Number.isFinite(price) ? price : null,
    currency: sku?.currency_code || sku?.currencyCode || null,
    shape: compactShape(sku)
  };
}
function normalizedLabel(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function selectSku(snapshot, product) {
  const skus = snapshot.skus || []; const selectedId = product.supplier_sku_id ? String(product.supplier_sku_id) : '';
  if (selectedId) { const byId = skus.find((sku) => sku.id === selectedId); if (byId) return byId; }
  const wanted = normalizedLabel(product.variant_label);
  if (wanted) {
    const exact = skus.filter((sku) => normalizedLabel(sku.label) === wanted); if (exact.length === 1) return exact[0];
    const containing = skus.filter((sku) => { const label = normalizedLabel(sku.label); return label && (label.includes(wanted) || wanted.includes(label)); }); if (containing.length === 1) return containing[0];
  }
  const available = skus.filter((sku) => sku.inStock !== false); return available.length === 1 ? available[0] : null;
}
async function callProductOnce(productId) {
  const json = await callTopApi(PRODUCT_METHOD, { product_id:String(productId), ship_to_country:'IL', target_currency:'USD', target_language:'EN' });
  const root = json.aliexpress_ds_product_get_response || json; const result = root.result || json.result || root; const base = result?.ae_item_base_info_dto || result || {};
  const skus = skuRows(result).map(normalizedSku).filter((sku) => sku.id);
  if (!skus.length && !base.product_status_type && !result?.product_status_type) throw new Error('product_get_empty');
  return { productId:String(productId), status:base.product_status_type || result?.product_status_type || null, skus };
}
async function callProduct(productId) {
  try { return await callProductOnce(productId); }
  catch (error) { const code=String(error.code||error.message||error); if(!/ApiCallLimit/i.test(code)) throw error; await sleep(2500); return callProductOnce(productId); }
}
async function writeHistory(product,row) {
  try {
    const { supabaseUrl }=serverConfig();
    await fetch(`${supabaseUrl}/rest/v1/supplier_sync_history`,{method:'POST',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({store_product_id:String(product.id),supplier_product_id:product.supplier_product_id||null,supplier_sku_id:product.supplier_sku_id||null,in_stock:row.inStock??null,stock:row.stock??null,price:row.price??null,currency:row.currency||null,price_ils:row.priceIls??null,shipping_available:row.shippingAvailable??null,shipping_ils:row.shippingIls??null,sync_error:row.error?String(row.error).slice(0,300):null})});
  } catch(error){console.warn('AliExpress catalog history write failed:',error.message);}
}
async function updateProduct(product,snapshot) {
  const { supabaseUrl }=serverConfig(); const selected=selectSku(snapshot,product); const selectedId=product.supplier_sku_id?String(product.supplier_sku_id):null; const selectedMissing=Boolean(selectedId&&!selected);
  const availableSkus=snapshot.skus.filter((sku)=>sku.inStock!==false); const fallback=availableSkus.find((sku)=>sku.price!=null)||snapshot.skus.find((sku)=>sku.price!=null)||null; const source=selected||fallback;
  const inStock=selected?selected.inStock:(snapshot.status?snapshot.status==='onSelling'&&availableSkus.length>0:null);
  const verifiedNoAttr=Boolean(selected && !selected.attr && snapshot.skus.length===1 && selected.attrFieldPresent && selected.propertyCount===0);
  const verifiedSkuAttr=selected?.attr || (verifiedNoAttr ? NO_SKU_ATTR : null);
  let supplierPriceIls=null; if(source?.price!=null&&source?.currency) supplierPriceIls=await convertToIls(source.price,source.currency);
  let freight=null,shippingError=null;
  if(selected?.id&&/^\d{5,30}$/.test(selected.id)){
    try{freight=await quoteAliExpressFreight({productId:product.supplier_product_id||snapshot.productId,skuId:selected.id,qty:1,countryCode:'IL',shipFromCountry:product.supplier_ship_from_country||'CN'});}catch(error){shippingError=String(error.code||error.message||error).slice(0,300);}
  }else shippingError=selected?'selected_numeric_sku_id_missing':'selected_sku_missing';
  const now=new Date().toISOString(); const skuVerified=Boolean(selected); const skuAttrVerified=Boolean(verifiedSkuAttr); const shippingAvailable=Boolean(freight);
  const ready=Boolean(product.active===true&&skuVerified&&skuAttrVerified&&selected.inStock===true&&shippingAvailable&&supplierPriceIls!=null);
  const supplierError=selectedMissing?'selected_sku_missing':(!skuAttrVerified?`selected_sku_attr_missing:${selected?.shape||'unknown_shape'}`:null);
  const update={supplier_sku_id:selected?.id||selectedId||null,supplier_sku_attr:verifiedSkuAttr,variant_label:selected?.label||product.variant_label||null,supplier_in_stock:selectedMissing?false:inStock,supplier_stock:selected?.stock??null,supplier_price:source?.price??null,supplier_currency:source?.currency||null,supplier_price_ils:supplierPriceIls,last_sync_at:now,supplier_sync_error:supplierError,shipping_sync_error:shippingError,sku_verified_at:skuVerified&&skuAttrVerified?now:null,sku_verified_by:skuVerified&&skuAttrVerified?'supplier_sync':null,fulfillment_ready:ready,updated_at:now};
  if(freight){update.supplier_shipping=freight.amountIls;update.shipping_currency='ILS';update.supplier_shipping_available=true;update.shipping_last_checked_at=now;}
  else if(shippingError==='no_shipping_option'){update.supplier_shipping=null;update.shipping_currency=null;update.supplier_shipping_available=false;update.shipping_last_checked_at=now;}
  else update.supplier_shipping_available=null;
  const response=await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify(update)});
  if(!response.ok) throw new Error(`product_sync_save_${response.status}_${(await response.text()).slice(0,180)}`);
  await writeHistory(product,{inStock:update.supplier_in_stock,stock:update.supplier_stock,price:update.supplier_price,currency:update.supplier_currency,priceIls:update.supplier_price_ils,shippingAvailable:update.supplier_shipping_available??null,shippingIls:Object.prototype.hasOwnProperty.call(update,'supplier_shipping')?update.supplier_shipping:null,error:update.supplier_sync_error||update.shipping_sync_error||null});
  return {ready,update};
}
async function markError(product,error){const{supabaseUrl}=serverConfig();const message=String(error.code||error.message||error).slice(0,300);await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({supplier_sync_error:message,fulfillment_ready:false,updated_at:new Date().toISOString()})}).catch(()=>{});await writeHistory(product,{error:message});return message;}
async function syncAllActiveAliExpressProducts(){const{supabaseUrl}=serverConfig();const response=await fetch(`${supabaseUrl}/rest/v1/products?select=*&active=eq.true&supplier=eq.aliexpress&supplier_product_id=not.is.null&order=sort_order.asc&limit=50`,{headers:serverHeaders()});if(!response.ok)throw new Error(`products_read_${response.status}`);const products=await response.json();const results=[];for(let index=0;index<products.length;index+=1){const product=products[index];if(index>0)await sleep(900);try{const snapshot=await callProduct(product.supplier_product_id);const saved=await updateProduct(product,snapshot);results.push({id:product.id,ok:true,ready:saved.ready,inStock:saved.update.supplier_in_stock,shippingAvailable:saved.update.supplier_shipping_available,skuAttrReady:Boolean(saved.update.supplier_sku_attr),noAttrSku:saved.update.supplier_sku_attr===NO_SKU_ATTR});}catch(error){const message=await markError(product,error);results.push({id:product.id,ok:false,error:message});}}return{synced:results.length,succeeded:results.filter((row)=>row.ok).length,results};}
module.exports={PRODUCT_METHOD,selectSku,syncAllActiveAliExpressProducts};
