-- Applied to production on 2026-08-16.
-- This protects order creation immediately, even if an older app deployment is still live.

create or replace function public.guard_order_insert_sales_enabled()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sales_enabled boolean := false;
begin
  select coalesce(sales_enabled, false)
    into v_sales_enabled
  from public.site_settings
  where id = 'primary'
  limit 1;

  if v_sales_enabled is not true then
    raise exception 'sales_disabled'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger if exists orders_sales_enabled_guard on public.orders;
create trigger orders_sales_enabled_guard
before insert on public.orders
for each row execute function public.guard_order_insert_sales_enabled();

revoke all on function public.guard_order_insert_sales_enabled() from public, anon, authenticated;
grant execute on function public.guard_order_insert_sales_enabled() to service_role;
