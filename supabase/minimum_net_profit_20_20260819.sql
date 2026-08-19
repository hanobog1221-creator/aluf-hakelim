-- Business pricing target: at least 20 ILS estimated net profit after payment,
-- VAT, operating fees, advertising, supplier buffer and the 40% tax reserve.

alter table public.site_settings
  alter column minimum_profit_ils set default 20;

update public.site_settings
set minimum_profit_ils = 20,
    updated_at = now()
where id = 'primary';

update public.products
set minimum_profit = 20,
    updated_at = now()
where minimum_profit is null or minimum_profit = 25;

-- Existing installations already have the readiness view. Rebuild its stored
-- expression so the database guard uses the same 20 ILS floor as the API.
do $$
declare
  view_definition text;
begin
  if to_regclass('public.product_fulfillment_readiness') is not null then
    select pg_get_viewdef('public.product_fulfillment_readiness'::regclass, true)
      into view_definition;
    view_definition := replace(view_definition, 'GREATEST((25)::numeric', 'GREATEST((20)::numeric');
    view_definition := replace(view_definition, 'COALESCE(p.minimum_profit, s.minimum_profit_ils, (25)::numeric)', 'COALESCE(p.minimum_profit, s.minimum_profit_ils, (20)::numeric)');
    execute 'create or replace view public.product_fulfillment_readiness as ' || view_definition;
    execute 'alter view public.product_fulfillment_readiness set (security_invoker = true)';
    execute 'revoke all on public.product_fulfillment_readiness from public, anon, authenticated';
    execute 'grant select on public.product_fulfillment_readiness to service_role';
  end if;
end $$;
