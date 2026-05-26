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
  'account_deletion_completion_requires_pending_due_and_durable_job_invariants' as check_name,
  pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%v_request.status%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%scheduled_deletion_at > now()%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%account_deletion_completion_jobs%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%completion_job_queued%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%auth_user_deleted'', false%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%profile_pii_scrubbed'', false%' as ok;

select
  'account_deletion_completed_rows_require_durable_evidence_or_legacy_checkpoint' as check_name,
  pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%COMPLETION_EVIDENCE_MISSING%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%COMPLETION_EVIDENCE_INCOMPLETE%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%v_hard_delete_evidence_complete%'
  and pg_get_functiondef('public.admin_mark_account_deletion_completed(uuid, text, text)'::regprocedure)
    like '%legacy_checkpoint%' as ok;

select
  'account_deletion_completion_jobs_guard_hard_delete_steps' as check_name,
  to_regclass('public.account_deletion_completion_jobs') is not null
  and to_regprocedure('public.complete_account_deletion_completion_step_v1(uuid, text, text, text, jsonb)') is not null
  and to_regprocedure('public.fail_account_deletion_completion_job_v1(uuid, text, text, text, integer, boolean, boolean)') is not null
  and exists (
    select 1
    from pg_trigger
    where tgname = 'trg_account_deletion_completion_guard'
      and not tgisinternal
  )
  and pg_get_functiondef('public.account_deletion_completion_guard()'::regprocedure)
    like '%provider_cleanup_completed_at IS NOT NULL%'
  and pg_get_functiondef('public.account_deletion_completion_guard()'::regprocedure)
    like '%media_cleanup_completed_at IS NOT NULL%'
  and pg_get_functiondef('public.account_deletion_completion_guard()'::regprocedure)
    like '%pii_scrub_completed_at IS NOT NULL%'
  and pg_get_functiondef('public.account_deletion_completion_guard()'::regprocedure)
    like '%auth_delete_completed_at IS NOT NULL%' as ok;

select
  'account_deletion_profile_scrub_clears_identity_and_entitlements' as check_name,
  pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%phone_number = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%verified_email = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%is_premium = false%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%premium_until = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%subscription_tier = ''free''%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%proof_selfie_url = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%bunny_video_uid = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%discoverable = false%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%last_seen_at = NULL%'
  and pg_get_functiondef('public.scrub_account_deletion_profile_pii_v1(uuid)'::regprocedure)
    like '%suspension_reason = NULL%' as ok;

select
  'account_deletion_completion_worker_rpcs_service_role_only' as check_name,
  count(*) = 5
  and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'enqueue_due_account_deletion_completion_jobs_v1',
    'claim_account_deletion_completion_jobs_v1',
    'complete_account_deletion_completion_step_v1',
    'fail_account_deletion_completion_job_v1',
    'scrub_account_deletion_profile_pii_v1'
  );

select
  'support_reply_delivery_worker_rpcs_service_role_only' as check_name,
  count(*) = 2
  and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_support_reply_delivery_jobs_v1',
    'complete_support_reply_delivery_job_v1'
  );

select
  'durable_admin_job_realtime_tables_have_explicit_grants_and_rls' as check_name,
  to_regclass('public.account_deletion_completion_jobs') is not null
  and to_regclass('public.support_reply_delivery_jobs') is not null
  and has_table_privilege('authenticated', 'public.account_deletion_completion_jobs', 'SELECT')
  and has_table_privilege('authenticated', 'public.support_reply_delivery_jobs', 'SELECT')
  and has_table_privilege('service_role', 'public.account_deletion_completion_jobs', 'SELECT')
  and has_table_privilege('service_role', 'public.account_deletion_completion_jobs', 'INSERT')
  and has_table_privilege('service_role', 'public.account_deletion_completion_jobs', 'UPDATE')
  and has_table_privilege('service_role', 'public.account_deletion_completion_jobs', 'DELETE')
  and has_table_privilege('service_role', 'public.support_reply_delivery_jobs', 'SELECT')
  and has_table_privilege('service_role', 'public.support_reply_delivery_jobs', 'INSERT')
  and has_table_privilege('service_role', 'public.support_reply_delivery_jobs', 'UPDATE')
  and has_table_privilege('service_role', 'public.support_reply_delivery_jobs', 'DELETE')
  and not has_table_privilege('anon', 'public.account_deletion_completion_jobs', 'SELECT')
  and not has_table_privilege('anon', 'public.support_reply_delivery_jobs', 'SELECT')
  and (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'account_deletion_completion_jobs'
  )
  and (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'support_reply_delivery_jobs'
  ) as ok;

select
  'account_deletion_list_reports_hidden_statuses' as check_name,
  pg_get_functiondef('public.admin_list_account_deletions(text, integer)'::regprocedure)
    like '%NOT IN (''pending'', ''completed'', ''cancelled'')%'
  and pg_get_functiondef('public.admin_list_account_deletions(text, integer)'::regprocedure)
    like '%''other'', v_other_count%' as ok;
