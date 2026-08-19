-- Server-only connector onboarding for additional dropshipping suppliers.
-- Credentials never become readable by public or authenticated storefront users.

create table if not exists public.supplier_connector_credentials (
  provider text primary key,
  api_key text,
  client_id text,
  client_secret text,
  base_url text,
  enabled boolean not null default false,
  api_verified boolean not null default false,
  api_verified_at timestamptz,
  order_verified boolean not null default false,
  order_verified_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_connector_provider_check check (provider in ('hypersku','banggood','eprolo','wiio')),
  constraint supplier_connector_base_url_check check (base_url is null or base_url ~* '^https://'),
  constraint supplier_connector_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint supplier_connector_activation_check check (enabled is false or (api_verified is true and order_verified is true))
);

insert into public.supplier_connector_credentials(provider,enabled,api_verified,order_verified,last_error)
values
  ('hypersku',false,false,false,'api_credentials_required'),
  ('banggood',false,false,false,'dropship_api_credentials_required'),
  ('eprolo',false,false,false,'api_document_and_credentials_required'),
  ('wiio',false,false,false,'account_agent_and_api_access_required')
on conflict (provider) do nothing;

alter table public.supplier_connector_credentials enable row level security;
revoke all privileges on table public.supplier_connector_credentials from public, anon, authenticated;
grant all privileges on table public.supplier_connector_credentials to service_role;

create index if not exists supplier_connector_readiness_idx
on public.supplier_connector_credentials(provider,enabled,api_verified,order_verified);

comment on table public.supplier_connector_credentials is
  'Server-only credentials and activation gates. A connector cannot be enabled before both API and real order tests are verified.';

select provider, enabled, api_verified, order_verified, last_error
from public.supplier_connector_credentials
order by provider;
