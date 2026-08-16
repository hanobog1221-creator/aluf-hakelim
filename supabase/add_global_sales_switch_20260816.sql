-- Applied to production on 2026-08-16.
-- Sales stay disabled until launch readiness is explicitly approved.

alter table public.site_settings
  add column if not exists sales_enabled boolean not null default false;

update public.site_settings
set sales_enabled = false
where id = 'primary'
  and sales_enabled is distinct from false;
