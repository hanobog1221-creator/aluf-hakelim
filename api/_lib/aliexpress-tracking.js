const { callTopApi } = require('./aliexpress');

const ORDER_DETAIL_METHOD = 'aliexpress.trade.ds.order.get';
const TRACKING_METHOD = 'aliexpress.logistics.ds.trackinginfo.query';
const PICKUP_PATTERN = /(ready\s+for\s+(?:pick[ -]?up|collection)|available\s+for\s+(?:pick[ -]?up|collection)|awaiting\s+(?:pick[ -]?up|collection)|pick[ -]?up\s+(?:point|station|location)|collection\s+(?:point|station|location)|parcel\s+(?:locker|shop|point)|locker|post\s+office|self[ -]?collect|נקודת\s+איסוף|ממתין\s+לאיסוף|מוכן\s+לאיסוף|לוקר)/i;

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function clean(value, max = 300) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizeWebsite(value) {
  const raw = clean(value, 500);
  if (!raw) return null;
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function orderResult(json) {
  return json?.aliexpress_trade_ds_order_get_response?.result
    || json?.aliexpressTradeDsOrderGetResponse?.result
    || json?.result
    || null;
}

function parseOrderDetailResponse(json) {
  const result = orderResult(json);
  if (!result) throw new Error('aliexpress_order_detail_missing');
  const rawList = result?.logistics_info_list?.aeop_order_logistics_info
    || result?.logisticsInfoList?.aeopOrderLogisticsInfo
    || result?.logistics_info_list
    || result?.logisticsInfoList
    || [];
  const logistics = asArray(rawList).map((row) => ({
    number: clean(row?.logistics_no ?? row?.logisticsNo, 200),
    service: clean(row?.logistics_service ?? row?.logisticsService, 160)
  })).filter((row) => row.number && row.service);
  return {
    orderStatus: clean(result?.order_status ?? result?.orderStatus, 80),
    logisticsStatus: clean(result?.logistics_status ?? result?.logisticsStatus, 80),
    logistics
  };
}

function trackingRoot(json) {
  return json?.aliexpress_logistics_ds_trackinginfo_query_response
    || json?.aliexpressLogisticsDsTrackinginfoQueryResponse
    || json
    || {};
}

function eventTimestamp(event) {
  const parsed = Date.parse(String(event?.eventDate || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTrackingResponse(json) {
  const root = trackingRoot(json);
  const success = root?.result_success ?? root?.resultSuccess;
  if (success === false || String(success).toLowerCase() === 'false') {
    const error = new Error(clean(root?.error_desc ?? root?.errorDesc, 300) || 'aliexpress_tracking_failed');
    error.code = 'aliexpress_tracking_failed';
    throw error;
  }
  const rawDetails = root?.details?.details ?? root?.details ?? [];
  const events = asArray(rawDetails).map((row) => ({
    description: clean(row?.event_desc ?? row?.eventDesc, 400),
    status: clean(row?.status, 100),
    address: clean(row?.address, 400),
    eventDate: clean(row?.event_date ?? row?.eventDate, 100)
  })).filter((row) => row.description || row.status || row.address || row.eventDate);

  const indexed = events.map((event, index) => ({ event, index, ts: eventTimestamp(event) }));
  indexed.sort((a, b) => (b.ts - a.ts) || (b.index - a.index));
  const latestEvent = indexed[0]?.event || null;
  const pickupEvent = indexed.find(({ event }) => PICKUP_PATTERN.test(`${event.description || ''} ${event.status || ''}`))?.event || null;

  return {
    officialWebsite: normalizeWebsite(root?.official_website ?? root?.officialWebsite),
    latestEvent,
    pickupPoint: pickupEvent ? {
      address: pickupEvent.address || null,
      description: pickupEvent.description || pickupEvent.status || 'Ready for pickup',
      eventDate: pickupEvent.eventDate || null
    } : null,
    events
  };
}

function supplierOrderIds(order) {
  const ids = [];
  for (const value of asArray(order?.supplier_order_ids)) {
    const id = String(value || '').trim();
    if (/^\d{5,30}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  const first = String(order?.supplier_order_id || '').trim();
  if (/^\d{5,30}$/.test(first) && !ids.includes(first)) ids.unshift(first);
  return ids;
}

function isAliExpressOrder(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.length > 0 && items.every((item) => {
    const provider = String(item?.fulfillmentProvider || item?.supplier || '').trim().toLowerCase();
    return provider === 'aliexpress';
  });
}

function trackingCacheFresh(order, maxAgeMs = 10 * 60 * 1000) {
  const rows = Array.isArray(order?.tracking_numbers) ? order.tracking_numbers : [];
  const synced = rows.map((row) => Date.parse(String(row?.syncedAt || ''))).filter(Number.isFinite);
  if (!synced.length) return false;
  return Date.now() - Math.max(...synced) < maxAgeMs;
}

async function refreshAliExpressTracking(order, options = {}) {
  if (!isAliExpressOrder(order)) return { skipped: true, reason: 'not_aliexpress_order' };
  const ids = supplierOrderIds(order);
  if (!ids.length) return { skipped: true, reason: 'supplier_order_missing' };
  if (!options.force && trackingCacheFresh(order, options.maxAgeMs)) {
    return { skipped: true, reason: 'tracking_cache_fresh' };
  }

  const rows = [];
  let orderStatus = null;
  let logisticsStatus = null;
  for (const supplierOrderId of ids) {
    const detailJson = await callTopApi(ORDER_DETAIL_METHOD, {
      single_order_query: { order_id: Number(supplierOrderId) }
    });
    const detail = parseOrderDetailResponse(detailJson);
    orderStatus = detail.orderStatus || orderStatus;
    logisticsStatus = detail.logisticsStatus || logisticsStatus;

    for (const logistics of detail.logistics) {
      let tracking = null;
      try {
        const trackingJson = await callTopApi(TRACKING_METHOD, {
          logistics_no: logistics.number,
          origin: 'ESCROW',
          out_ref: supplierOrderId,
          service_name: logistics.service,
          to_area: 'IL'
        });
        tracking = parseTrackingResponse(trackingJson);
      } catch (error) {
        console.warn('AliExpress tracking detail unavailable:', supplierOrderId, logistics.number, error.code || error.message);
      }
      rows.push({
        number: logistics.number,
        provider: logistics.service,
        url: tracking?.officialWebsite || null,
        status: tracking?.latestEvent?.status || logisticsStatus || null,
        supplierOrderId,
        latestEvent: tracking?.latestEvent || null,
        pickupPoint: tracking?.pickupPoint || null,
        syncedAt: new Date().toISOString()
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.supplierOrderId}:${row.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return {
    skipped: false,
    orderStatus,
    logisticsStatus,
    trackingNumber: deduped[0]?.number || null,
    trackingNumbers: deduped,
    pickupPoint: deduped.find((row) => row.pickupPoint)?.pickupPoint || null
  };
}

module.exports = {
  ORDER_DETAIL_METHOD,
  TRACKING_METHOD,
  PICKUP_PATTERN,
  parseOrderDetailResponse,
  parseTrackingResponse,
  supplierOrderIds,
  isAliExpressOrder,
  trackingCacheFresh,
  refreshAliExpressTracking
};
