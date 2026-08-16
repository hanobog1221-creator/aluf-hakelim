-- Applied to production on 2026-08-16.
-- Payment initiation stays blocked while the global sales switch is off.

create or replace function public.check_order_payment_readiness(p_order_id text)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  o public.orders%rowtype;
  item jsonb;
  r public.product_fulfillment_readiness%rowtype;
  c public.coupons%rowtype;
  expected_amount numeric;
  ttl_minutes integer := 30;
  v_sales_enabled boolean := false;
begin
  select * into o
  from public.orders
  where order_id = p_order_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select coalesce(payment_quote_ttl_minutes, 30), coalesce(sales_enabled, false)
    into ttl_minutes, v_sales_enabled
  from public.site_settings
  where id = 'primary'
  limit 1;
  ttl_minutes := greatest(5, least(180, coalesce(ttl_minutes, 30)));

  if v_sales_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'sales_disabled');
  end if;

  if o.status not in ('draft','payment_pending') then
    return jsonb_build_object('ok', false, 'reason', 'order_status_not_payable', 'status', o.status);
  end if;

  if o.payment_status not in ('unpaid','failed') then
    return jsonb_build_object('ok', false, 'reason', 'payment_already_in_progress_or_complete', 'paymentStatus', o.payment_status);
  end if;

  if o.terms_accepted_at is null or nullif(trim(coalesce(o.terms_version,'')),'') is null then
    return jsonb_build_object('ok', false, 'reason', 'terms_not_recorded');
  end if;

  if o.shipping_quote_status <> 'quoted' or o.shipping_quoted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'shipping_not_quoted');
  end if;

  if o.shipping_quoted_at < now() - make_interval(mins => ttl_minutes)
     or o.shipping_quoted_at > now() + interval '1 minute' then
    return jsonb_build_object('ok', false, 'reason', 'shipping_quote_stale', 'shippingQuotedAt', o.shipping_quoted_at, 'quoteTtlMinutes', ttl_minutes);
  end if;

  if o.coupon_code is not null then
    select * into c
    from public.coupons
    where code = o.coupon_code
    for update;

    if not found or c.active is not true then return jsonb_build_object('ok', false, 'reason', 'coupon_unavailable'); end if;
    if c.starts_at is not null and c.starts_at > now() then return jsonb_build_object('ok', false, 'reason', 'coupon_not_started'); end if;
    if c.ends_at is not null and c.ends_at < now() then return jsonb_build_object('ok', false, 'reason', 'coupon_expired'); end if;
    if c.usage_limit is not null and coalesce(c.used_count,0) >= c.usage_limit then return jsonb_build_object('ok', false, 'reason', 'coupon_limit_reached'); end if;
  end if;

  if o.supplier_order_id is not null
     or (jsonb_typeof(o.supplier_order_ids) = 'array' and jsonb_array_length(o.supplier_order_ids) > 0) then
    return jsonb_build_object('ok', false, 'reason', 'supplier_order_already_exists');
  end if;

  if o.items is null or jsonb_typeof(o.items) <> 'array' or jsonb_array_length(o.items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'order_items_missing');
  end if;

  for item in select value from jsonb_array_elements(o.items)
  loop
    if coalesce(item->>'fulfillmentReady','false') <> 'true' then
      return jsonb_build_object('ok', false, 'reason', 'order_snapshot_not_fulfillment_ready', 'productId', item->>'id');
    end if;

    select * into r
    from public.product_fulfillment_readiness
    where id = item->>'id'
    limit 1;

    if not found then return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'productId', item->>'id'); end if;

    if r.ready_for_paid_order is not true then
      return jsonb_build_object('ok', false, 'reason', 'current_product_not_ready', 'productId', r.id, 'blockers', to_jsonb(r.blockers));
    end if;

    if r.supplier_product_id is distinct from (item->>'supplierProductId')
       or r.supplier_sku_id is distinct from (item->>'supplierSkuId') then
      return jsonb_build_object('ok', false, 'reason', 'supplier_mapping_changed', 'productId', r.id);
    end if;
  end loop;

  expected_amount := round(coalesce(o.total,0) + coalesce(o.shipping_cost,0), 2);
  if expected_amount <= 0 or expected_amount > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_order_amount');
  end if;

  return jsonb_build_object(
    'ok', true,
    'orderId', o.order_id,
    'amount', expected_amount,
    'currency', o.currency,
    'shippingQuotedAt', o.shipping_quoted_at,
    'quoteTtlMinutes', ttl_minutes,
    'termsVersion', o.terms_version,
    'couponCode', o.coupon_code
  );
end;
$function$;

revoke all on function public.check_order_payment_readiness(text) from public, anon, authenticated;
grant execute on function public.check_order_payment_readiness(text) to service_role;
