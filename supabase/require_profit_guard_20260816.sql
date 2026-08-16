-- Require an explicit profit guard before any product can be considered ready for paid fulfillment.
-- Applied to production on 2026-08-16.

create or replace view public.product_fulfillment_readiness as
select
  p.id,
  p.name,
  p.active,
  p.fulfillment_ready,
  p.supplier,
  p.supplier_product_id,
  p.supplier_sku_id,
  p.variant_label,
  p.sku_verified_at,
  p.sku_verified_by,
  p.supplier_in_stock,
  p.supplier_stock,
  p.supplier_price_ils,
  p.supplier_shipping_available,
  p.supplier_shipping,
  p.last_sync_at,
  p.shipping_last_checked_at,
  p.supplier_sync_error,
  p.shipping_sync_error,
  nullif(trim(coalesce(p.supplier_product_id,'')),'') is not null as has_supplier_product_id,
  nullif(trim(coalesce(p.supplier_sku_id,'')),'') is not null as has_supplier_sku_id,
  p.sku_verified_at is not null as sku_verified,
  p.supplier_in_stock is not null as stock_known,
  p.supplier_shipping_available is not null as shipping_known,
  p.supplier_price_ils is not null as supplier_price_known,
  (
    p.active is true
    and p.fulfillment_ready is true
    and lower(coalesce(p.supplier,'')) = 'aliexpress'
    and nullif(trim(coalesce(p.supplier_product_id,'')),'') is not null
    and nullif(trim(coalesce(p.supplier_sku_id,'')),'') is not null
    and p.sku_verified_at is not null
    and p.supplier_in_stock is true
    and p.supplier_shipping_available is true
    and p.supplier_price_ils is not null
    and p.last_sync_at >= now() - interval '8 hours'
    and p.shipping_last_checked_at >= now() - interval '8 hours'
    and p.supplier_sync_error is null
    and p.shipping_sync_error is null
    and coalesce(p.minimum_profit, s.minimum_profit_ils) is not null
    and p.selling_price - p.supplier_price_ils >= coalesce(p.minimum_profit, s.minimum_profit_ils)
    and (
      p.auto_fulfill_max_cost is null
      or (
        p.supplier_shipping is not null
        and p.supplier_price_ils + p.supplier_shipping <= p.auto_fulfill_max_cost
      )
    )
  ) as ready_for_paid_order,
  array_remove(array[
    case when p.active is not true then 'product_inactive' end,
    case when lower(coalesce(p.supplier,'')) <> 'aliexpress' then 'unsupported_supplier' end,
    case when nullif(trim(coalesce(p.supplier_product_id,'')),'') is null then 'supplier_product_id_missing' end,
    case when nullif(trim(coalesce(p.supplier_sku_id,'')),'') is null then 'supplier_sku_id_missing' end,
    case when p.sku_verified_at is null then 'supplier_sku_not_verified' end,
    case when p.supplier_in_stock is false then 'supplier_out_of_stock' end,
    case when p.supplier_in_stock is null then 'supplier_stock_unknown' end,
    case when p.supplier_shipping_available is false then 'supplier_shipping_unavailable' end,
    case when p.supplier_shipping_available is null then 'supplier_shipping_unknown' end,
    case when p.supplier_price_ils is null then 'supplier_price_unknown' end,
    case when p.last_sync_at is null or p.last_sync_at < now() - interval '8 hours' then 'supplier_product_sync_stale' end,
    case when p.shipping_last_checked_at is null or p.shipping_last_checked_at < now() - interval '8 hours' then 'supplier_shipping_sync_stale' end,
    case when p.supplier_sync_error is not null then 'supplier_sync_error' end,
    case when p.shipping_sync_error is not null then 'shipping_sync_error' end,
    case when coalesce(p.minimum_profit, s.minimum_profit_ils) is null then 'minimum_profit_not_configured' end,
    case when coalesce(p.minimum_profit, s.minimum_profit_ils) is not null
              and p.supplier_price_ils is not null
              and p.selling_price - p.supplier_price_ils < coalesce(p.minimum_profit, s.minimum_profit_ils)
         then 'minimum_profit_not_met' end,
    case when p.auto_fulfill_max_cost is not null
              and (p.supplier_price_ils is null or p.supplier_shipping is null)
         then 'supplier_cost_unknown_for_auto_limit' end,
    case when p.auto_fulfill_max_cost is not null
              and p.supplier_price_ils is not null
              and p.supplier_shipping is not null
              and p.supplier_price_ils + p.supplier_shipping > p.auto_fulfill_max_cost
         then 'supplier_cost_above_auto_limit' end
  ], null) as blockers
from public.products p
left join public.site_settings s on s.id = 'primary';

alter view public.product_fulfillment_readiness set (security_invoker = true);
revoke all on public.product_fulfillment_readiness from public, anon, authenticated;
grant select on public.product_fulfillment_readiness to service_role;
