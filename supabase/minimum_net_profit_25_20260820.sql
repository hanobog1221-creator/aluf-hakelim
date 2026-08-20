-- Owner-approved business target: at least 25 ILS estimated net profit after
-- payment fees, VAT, operating costs and the configured tax/insurance reserve.

alter table public.site_settings
  alter column minimum_profit_ils set default 25;

update public.site_settings
set minimum_profit_ils = 25,
    updated_at = now()
where id = 'primary';

update public.products
set minimum_profit = 25,
    updated_at = now()
where minimum_profit is distinct from 25;
