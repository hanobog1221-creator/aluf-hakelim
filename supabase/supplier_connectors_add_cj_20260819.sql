-- Adds the self-service CJ API connector to projects that already ran
-- supplier_connectors_20260819.sql.

alter table public.supplier_connector_credentials
  drop constraint if exists supplier_connector_provider_check;

alter table public.supplier_connector_credentials
  add constraint supplier_connector_provider_check
  check (provider in ('cj','hypersku','banggood','eprolo','wiio'));

insert into public.supplier_connector_credentials(
  provider, enabled, api_verified, order_verified, last_error
)
values ('cj', false, false, false, 'api_credentials_required')
on conflict (provider) do nothing;

select provider, enabled, api_verified, order_verified, last_error
from public.supplier_connector_credentials
order by provider;
