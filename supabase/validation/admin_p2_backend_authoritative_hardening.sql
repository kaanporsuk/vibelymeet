-- Read-only validation pack for admin_p2_backend_authoritative_hardening.

select
  'admin_idempotency_keys_exists' as check_name,
  to_regclass('public.admin_idempotency_keys') is not null as ok;

select
  'admin_idempotency_unique_constraint_exists' as check_name,
  exists (
    select 1
    from pg_constraint
    where conname = 'admin_idempotency_keys_unique'
      and conrelid = 'public.admin_idempotency_keys'::regclass
  ) as ok;

select
  'schema_parity_admin_critical_objects_exist' as check_name,
  bool_and(to_regclass(obj) is not null) as ok
from unnest(array[
  'public.premium_history',
  'public.feedback',
  'public.admin_activity_logs',
  'public.credit_adjustments'
]) as t(obj);

select
  'push_notification_events_admin_view_removed' as check_name,
  to_regclass('public.push_notification_events_admin') is null as ok;

select
  'admin_list_push_notification_events_rpc_acl_and_redaction' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_list_push_notification_events'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and pg_get_functiondef(p.oid) like '%SET search_path = public, pg_catalog%'
      and pg_get_functiondef(p.oid) like '%CASE WHEN fcm_message_id IS NULL THEN NULL ELSE ''[REDACTED]''::text END%'
      and pg_get_functiondef(p.oid) like '%CASE WHEN apns_message_id IS NULL THEN NULL ELSE ''[REDACTED]''::text END%'
      and pg_get_functiondef(p.oid) like '%CASE WHEN device_token IS NULL THEN NULL ELSE ''[REDACTED]''::text END%'
  ) as ok;

select
  'admin_p2_rpc_acl_and_security_definer' as check_name,
  bool_and(p.prosecdef)
  and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_adjust_user_credits',
    'admin_set_premium_status',
    'admin_resolve_report',
    'admin_moderate_user',
    'admin_review_photo_verification',
    'admin_create_event',
    'admin_update_event',
    'admin_end_event',
    'admin_extend_event',
    'admin_go_live_event',
    'admin_archive_event',
    'admin_unarchive_event',
    'admin_bulk_archive_events',
    'admin_generate_recurring_events',
    'admin_send_event_reminder',
    'admin_list_notifications',
    'admin_get_notification_counts',
    'admin_mark_notifications_read',
    'admin_delete_notifications',
    'admin_get_overview_metrics',
    'admin_search_users',
    'admin_get_event_metrics',
    'admin_get_push_delivery_metrics',
    'admin_list_push_notification_events'
  );

select
  'raw_generate_recurring_events_not_public' as check_name,
  not has_function_privilege('anon', 'public.generate_recurring_events(uuid, integer)'::regprocedure, 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.generate_recurring_events(uuid, integer)'::regprocedure, 'EXECUTE') as ok;

select
  'admin_overview_metrics_documents_utc' as check_name,
  pg_get_functiondef('public.admin_get_overview_metrics(timestamptz)'::regprocedure) like '%reporting_timezone%' as ok;

select
  'admin_p2_functions_use_auth_uid_and_has_role' as check_name,
  bool_and(pg_get_functiondef(p.oid) like '%auth.uid()%')
  and bool_and(pg_get_functiondef(p.oid) like '%has_role%') as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_adjust_user_credits',
    'admin_set_premium_status',
    'admin_resolve_report',
    'admin_moderate_user',
    'admin_review_photo_verification',
    'admin_end_event',
    'admin_extend_event',
    'admin_go_live_event',
    'admin_delete_notifications',
    'admin_list_push_notification_events'
  );
