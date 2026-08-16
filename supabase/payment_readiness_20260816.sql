-- Service-only payment readiness gate applied to production on 2026-08-16.
-- A payment provider should call this before creating a payment session.

create or replace function public.check_order_payment_readiness(p_order_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  o public.orders%rowtype;
  item jsonb;
  r public.product_fulfillment_readiness%rowtype;
  expected_amount numeric;
begin
  select * into o from public.orders where order_id = p_order_id limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;

  if o.status not in ('draft','payment_pending') then
    return jsonb_build_object('ok',false,'reason','order_status_not_payable','status',o.status);
  end if;
  if o.payment_status not in ('unpaid','failed') then
    return jsonb_build_object('ok',false,'reason','payment_already_in_progress_or_complete','paymentStatus',o.payment_status);
  end if;
  if o.terms_accepted_at is null or nullif(trim(coalesce(o.terms_version,'')),'') is null then
    return jsonb_build_object('ok',false,'reason','terms_not_recorded');
  end if;
  if o.shipping_quote_status <> 'quoted' or o.shipping_quoted_at is null then
    return jsonb_build_object('ok',false,'reason','shipping_not_quoted');
  end if;
  if o.supplier_order_id is not null
     or (jsonb_typeof(o.supplier_order_ids)='array' and jsonb_array_length(o.supplier_order_ids)>0) then
    return jsonb_build_object('ok',false,'reason','supplier_order_already_exists');
  end if;
  if o.items is null or jsonb_typeof(o.items)<>'array' or jsonb_array_length(o.items)=0 then
    return jsonb_build_object('ok',false,'reason','order_items_missing');
  end if;

  for item in select value from jsonb_array_elements(o.items)
  loop
    if coalesce(item->>'fulfillmentReady','false') <> 'true' then
      return jsonb_build_object('ok',false,'reason','order_snapshot_not_fulfillment_ready','productId',item->>'id');
    end if;

    select * into r from public.product_fulfillment_readiness where id=item->>'id' limit 1;
    if not found then
      return jsonb_build_object('ok',false,'reason','product_not_found','productId',item->>'id');
    end if;
    if r.ready_for_paid_order is not true then
      return jsonb_build_object('ok',false,'reason','current_product_not_ready','productId',r.id,'blockers',to_jsonb(r.blockers));
    end if;
    if r.supplier_product_id is distinct from (item->>'supplierProductId')
       or r.supplier_sku_id is distinct from (item->>'supplierSkuId') then
      return jsonb_build_object('ok',false,'reason','supplier_mapping_changed','productId',r.id);
    end if;
  end loop;

  expected_amount := round(coalesce(o.total,0)+coalesce(o.shipping_cost,0),2);
  if expected_amount < 0 then return jsonb_build_object('ok',false,'reason','invalid_order_amount'); end if;

  return jsonb_build_object(
    'ok',true,
    'orderId',o.order_id,
    'amount',expected_amount,
    'currency',o.currency,
    'shippingQuotedAt',o.shipping_quoted_at,
    'termsVersion',o.terms_version
  );
end;
$$;

revoke execute on function public.check_order_payment_readiness(text) from public, anon, authenticated;
grant execute on function public.check_order_payment_readiness(text) to service_role;
