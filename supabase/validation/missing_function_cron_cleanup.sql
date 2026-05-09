-- Missing-function cron cleanup validation pack.
-- Read-only checks for 20260509231000_unschedule_missing_function_crons.sql.

with checks as (
select
  'missing_function_cron_cleanup_no_retired_jobs' as check_name,
  not exists (
    select 1
    from cron.job
    where jobname in ('process-notification-outbox', 'email-drip-hourly')
      or command ilike '%/functions/v1/process-notification-outbox%'
      or command ilike '%/functions/v1/email-drip%'
  ) as ok
union all

select
  'missing_function_cron_cleanup_classified' as check_name,
  exists (
    select 1
    from public.migration_classifications
    where migration_version = '20260509231000'
      and classification = 'schema-only'
      and destructive_requires_signoff = false
  ) as ok
)
select check_name, ok
from checks
order by check_name;
