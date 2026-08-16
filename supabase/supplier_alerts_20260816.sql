-- Supplier alert improvements applied to production on 2026-08-16.

create or replace function public.raise_supplier_alert(p_store_product_id text, p_alert_type text, p_severity text, p_message text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.supplier_alerts(store_product_id, alert_type, severity, message, details)
  values(p_store_product_id, p_alert_type, p_severity, p_message, coalesce(p_details,'{}'::jsonb))
  on conflict (store_product_id, alert_type) where resolved_at is null
  do update set
    severity = excluded.severity,
    message = excluded.message,
    details = excluded.details,
    last_seen_at = now();
end;
$$;
revoke execute on function public.raise_supplier_alert(text,text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.process_supplier_sync_alerts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prev public.supplier_sync_history%rowtype;
  pct numeric;
begin
  select * into prev
  from public.supplier_sync_history
  where store_product_id = new.store_product_id
    and id < new.id
  order by id desc
  limit 1;

  if new.sync_error is not null then
    perform public.raise_supplier_alert(new.store_product_id,'sync_error','warning','שגיאה בסנכרון מול הספק',jsonb_build_object('error',new.sync_error));
    return new;
  else
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='sync_error' and resolved_at is null;
  end if;

  if new.in_stock is null then
    perform public.raise_supplier_alert(new.store_product_id,'stock_unknown','warning','מצב המלאי אצל הספק לא ידוע',jsonb_build_object('sync_history_id',new.id));
  else
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='stock_unknown' and resolved_at is null;
  end if;

  if new.in_stock is false and (prev.id is null or prev.in_stock is distinct from false) then
    perform public.raise_supplier_alert(new.store_product_id,'out_of_stock','critical','המוצר אזל במלאי אצל הספק',jsonb_build_object('stock',new.stock));
  elsif new.in_stock is true then
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='out_of_stock' and resolved_at is null;
  end if;

  if new.shipping_available is null then
    perform public.raise_supplier_alert(new.store_product_id,'shipping_unknown','warning','זמינות המשלוח אצל הספק לא ידועה',jsonb_build_object('sync_history_id',new.id));
  else
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='shipping_unknown' and resolved_at is null;
  end if;

  if new.shipping_available is false and (prev.id is null or prev.shipping_available is distinct from false) then
    perform public.raise_supplier_alert(new.store_product_id,'shipping_unavailable','critical','הספק הפסיק להציע משלוח ליעד','{}'::jsonb);
  elsif new.shipping_available is true then
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='shipping_unavailable' and resolved_at is null;
  end if;

  if new.price_ils is null then
    perform public.raise_supplier_alert(new.store_product_id,'supplier_price_unknown','warning','מחיר הספק בש״ח לא ידוע',jsonb_build_object('currency',new.currency,'price',new.price));
  else
    update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
    where store_product_id=new.store_product_id and alert_type='supplier_price_unknown' and resolved_at is null;
  end if;

  if prev.price_ils is not null and new.price_ils is not null and prev.price_ils > 0 then
    pct := ((new.price_ils - prev.price_ils) / prev.price_ils) * 100;
    if pct >= 10 then
      perform public.raise_supplier_alert(new.store_product_id,'supplier_price_jump',case when pct >= 25 then 'critical' else 'warning' end,'מחיר הספק עלה משמעותית',jsonb_build_object('previous_price_ils',prev.price_ils,'new_price_ils',new.price_ils,'change_percent',round(pct,2)));
    elsif new.price_ils <= prev.price_ils then
      update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
      where store_product_id=new.store_product_id and alert_type='supplier_price_jump' and resolved_at is null;
    end if;
  end if;

  if prev.shipping_ils is not null and new.shipping_ils is not null and prev.shipping_ils > 0 then
    pct := ((new.shipping_ils - prev.shipping_ils) / prev.shipping_ils) * 100;
    if pct >= 25 then
      perform public.raise_supplier_alert(new.store_product_id,'shipping_price_jump','warning','עלות המשלוח אצל הספק עלתה משמעותית',jsonb_build_object('previous_shipping_ils',prev.shipping_ils,'new_shipping_ils',new.shipping_ils,'change_percent',round(pct,2)));
    elsif new.shipping_ils <= prev.shipping_ils then
      update public.supplier_alerts set resolved_at=now(),last_seen_at=now()
      where store_product_id=new.store_product_id and alert_type='shipping_price_jump' and resolved_at is null;
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.process_supplier_sync_alerts() from public, anon, authenticated;
