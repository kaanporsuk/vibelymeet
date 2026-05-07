-- Read-only validation pack for Account Deletions admin hardening.

select
  'admin_account_deletions_rpcs_exist' as check_name,
  to_regprocedure('public.admin_list_account_deletions(text, integer)') is not null
  and to_regprocedure('public.admin_mark_account_deletion_completed(uuid, text, text)') is not null as ok;

select
  'admin_account_deletions_rpcs_acl_and_security_definer' as check_name,
  count(*) = 2
  and bool_and(p.prosecdef)
  and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_list_account_deletions',
    'admin_mark_account_deletion_completed'
  );

select
  'account_deletion_requests_no_direct_admin_table_policy' as check_name,
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_deletion_requests'
      and (
        policyname ilike '%admin%'
        or coalesce(qual, '') like '%has_role%'
        or coalesce(qual, '') like '%admin_user_has_permission%'
        or coalesce(with_check, '') like '%has_role%'
        or coalesce(with_check, '') like '%admin_user_has_permission%'
      )
  ) as ok;

select
  'account_deletion_requests_rls_enabled' as check_name,
  c.relrowsecurity as ok
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'account_deletion_requests';

select
  'account_deletion_requests_user_read_and_service_role_remain' as check_name,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_deletion_requests'
      and policyname = 'Users read own deletion request'
      and cmd = 'SELECT'
  )
  and exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_deletion_requests'
      and policyname = 'Service role manages deletion requests'
      and cmd = 'ALL'
  ) as ok;

select
  'account_deletion_completion_requires_pending_due_and_checkpoint_invariants' as check_name,
  pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%v_before.status%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%scheduled_deletion_at > now()%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%completed_at = now()%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%cancelled_at = NULL%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%auth_user_deleted'', false%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%profile_deleted'', false%' as ok;

select
  'account_deletion_list_reports_hidden_statuses' as check_name,
  pg_get_functiondef('public.admin_list_account_deletions(text, integer)'::regprocedure)
    like '%NOT IN (''pending'', ''completed'', ''cancelled'')%'
  and pg_get_functiondef('public.admin_list_account_deletions(text, integer)'::regprocedure)
    like '%''other'', v_other_count%' as ok;
