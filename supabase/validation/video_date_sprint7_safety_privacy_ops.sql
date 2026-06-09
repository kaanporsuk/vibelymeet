-- Sprint 7 safety/privacy/ops validation pack.
-- Safe for SQL editor/local validation: read-only catalog and function-definition checks.

with checks(check_name, ok) as (
  -- 1) User-facing safety actions are authenticated-only and server-owned.
  select
    'video_date_sprint7_safety_rpc_acl',
    not has_function_privilege('anon', 'public.submit_user_report(uuid,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.submit_user_report(uuid,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.block_user_with_cleanup(uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.block_user_with_cleanup(uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.submit_video_date_safety_report_v2(uuid,text,text,boolean,boolean,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.submit_video_date_safety_report_v2(uuid,text,text,boolean,boolean,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.submit_video_date_safety_report_v2(uuid,text,text,boolean,boolean,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.submit_post_date_verdict_v3(uuid,boolean,text,jsonb,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.submit_post_date_verdict_v3(uuid,boolean,text,jsonb,text)', 'EXECUTE')

  union all

  -- 2) Sprint 7 operator health is a service-role-only aggregate surface.
  select
    'video_date_sprint7_ops_health_service_role_only',
    not has_function_privilege('anon', 'public.get_video_date_sprint7_ops_health(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_video_date_sprint7_ops_health(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_video_date_sprint7_ops_health(uuid)', 'EXECUTE')
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%SECURITY DEFINER%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%auth.role() IS DISTINCT FROM ''service_role''%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%privacy_contract%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%counts_enum_reasons_and_operational_ids_only%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%daily_tokens%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%freeform_report_details%'

  union all

  -- 3) Operator health covers the Sprint 7 dashboard dimensions.
  select
    'video_date_sprint7_ops_health_dashboard_dimensions',
    pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%stuck_ready_gate_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%prepare_entry_failure_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%daily_join_failure_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%pending_survey_recovery_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%webhook_dlq_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%orphan_room_cleanup_rows%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)'::regprocedure) like '%report_with_block_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%queue_drain_miss_count%'
    and pg_get_functiondef('public.get_video_date_sprint7_ops_health(uuid)'::regprocedure) like '%queue_drain_failure_count%'

  union all

  -- 4) Sensitive operator tables remain RLS/private to service role.
  select
    'video_date_sprint7_private_operator_tables',
    (
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'video_date_provider_outbox'
    )
    and not has_table_privilege('anon', 'public.video_date_provider_outbox', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_provider_outbox', 'SELECT')
    and has_table_privilege('service_role', 'public.video_date_provider_outbox', 'SELECT')
    and (
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'video_date_webhook_dlq'
    )
    and not has_table_privilege('anon', 'public.video_date_webhook_dlq', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_webhook_dlq', 'SELECT')
    and has_table_privilege('service_role', 'public.video_date_webhook_dlq', 'SELECT')
    and (
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'video_date_provider_dead_letters'
    )
    and not has_table_privilege('anon', 'public.video_date_provider_dead_letters', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_provider_dead_letters', 'SELECT')
    and has_table_privilege('service_role', 'public.video_date_provider_dead_letters', 'SELECT')
    and (
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'video_date_orphan_room_cleanup_audit'
    )
    and not has_table_privilege('anon', 'public.video_date_orphan_room_cleanup_audit', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_orphan_room_cleanup_audit', 'SELECT')
    and has_table_privilege('service_role', 'public.video_date_orphan_room_cleanup_audit', 'SELECT')
    and (
      select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'event_loop_observability_events'
    )
    and not has_table_privilege('anon', 'public.event_loop_observability_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_loop_observability_events', 'SELECT')
    and has_table_privilege('service_role', 'public.event_loop_observability_events', 'SELECT')

  union all

  -- 5) Runtime client read/write surfaces stay caller scoped and token-free.
  select
    'video_date_sprint7_runtime_access_boundaries',
    not has_function_privilege('anon', 'public.get_video_date_snapshot_core(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_video_date_snapshot_core(uuid)', 'EXECUTE')
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure) like '%v_uid uuid := auth.uid()%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure) like '%not_participant%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure) not ilike '%meeting_token%'
    and to_regprocedure('public.get_video_date_queue_hint_v1(uuid,uuid)') is null
    and not has_function_privilege('anon', 'public.record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_video_date_client_stuck_observability(uuid,text,jsonb,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_video_date_client_stuck_observability(uuid,text,jsonb,integer)', 'EXECUTE')

  union all

  -- 6) Webhook/outbox/orphan payload paths reject secret-shaped payloads.
  select
    'video_date_sprint7_payload_sanitization_contract',
    pg_get_functiondef('public.video_date_jsonb_has_secret_key(jsonb)'::regprocedure) like '%secret%'
    and pg_get_functiondef('public.record_video_date_webhook_dlq_v1(text,text,text,text,text,jsonb,text,text,boolean,timestamp with time zone)'::regprocedure) like '%video_date_jsonb_has_secret_key(v_payload)%'
    and pg_get_functiondef('public.record_video_date_webhook_dlq_v1(text,text,text,text,text,jsonb,text,text,boolean,timestamp with time zone)'::regprocedure) like '%secret_payload_rejected%'
    and not has_function_privilege('anon', 'public.record_video_date_webhook_dlq_v1(text,text,text,text,text,jsonb,text,text,boolean,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.record_video_date_webhook_dlq_v1(text,text,text,text,text,jsonb,text,text,boolean,timestamp with time zone)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.record_video_date_webhook_dlq_v1(text,text,text,text,text,jsonb,text,text,boolean,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_video_date_orphan_room_cleanup_audit_v2(text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.record_video_date_orphan_room_cleanup_audit_v2(text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.record_video_date_orphan_room_cleanup_audit_v2(text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.video_date_orphan_safety_interlock_v1(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.video_date_orphan_safety_interlock_v1(uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.video_date_orphan_safety_interlock_v1(uuid,text)', 'EXECUTE')
)
select check_name, ok
from checks
order by check_name;
