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
