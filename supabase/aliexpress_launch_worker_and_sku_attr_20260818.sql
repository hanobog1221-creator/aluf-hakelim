-- Applied to production on 2026-08-18.
-- Adds the AliExpress SKU attribute path required by placeorder and a protected
-- hourly product/stock/shipping refresh job for the AliExpress-first launch.

alter table public.products
  add column if not exists supplier_sku_attr text;

alter table public.products
  drop constraint if exists products_supplier_sku_attr_length;
alter table public.products
  add constraint products_supplier_sku_attr_length
  check (supplier_sku_attr is null or char_length(supplier_sku_attr) between 1 and 1000);

create or replace function public.get_launch_cron_status()
returns table(jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, cron
as $$
  select j.jobname::text, j.schedule::text, j.active
  from cron.job as j
  where j.jobname in (
    'aliexpress-catalog-hourly',
    'cj-sourcing-hourly',
    'cj-catalog-hourly',
    'cj-sourcing-daily-retry',
    'cj-orders-every-30m'
  )
  order by j.jobname;
$$;

revoke all on function public.get_launch_cron_status() from public;
revoke all on function public.get_launch_cron_status() from anon;
revoke all on function public.get_launch_cron_status() from authenticated;
grant execute on function public.get_launch_cron_status() to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'aliexpress-catalog-hourly'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'aliexpress-catalog-hourly',
  '12 * * * *',
  $job$
  select net.http_get(
    url := 'https://aluf-hakelim-v2-ready.vercel.app/api/aliexpress/catalog-worker',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Accept','application/json',
      'x-cj-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='cj_worker_token' limit 1)
    ),
    timeout_milliseconds := 60000
  );
  $job$
);
