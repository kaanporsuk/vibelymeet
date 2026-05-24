-- Phase 5 RLS + public API validation pack.
-- Safe for SQL editor/local validation: read-only catalog and function-definition checks.

with checks(check_name, ok) as (
  -- 1) Public caller RPCs are authenticated-only and service-role callable.
  select
    'video_date_phase5_public_rpc_acl',
    not has_function_privilege('anon', 'public.get_event_deck_v3(uuid,uuid,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_event_deck_v3(uuid,uuid,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_event_deck_v3(uuid,uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_video_date_queue_hint_v1(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_video_date_queue_hint_v1(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_video_date_queue_hint_v1(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_event_ticket_payment_status_v1(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_event_ticket_payment_status_v1(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_event_ticket_payment_status_v1(uuid)', 'EXECUTE')

  union all

  -- 2) Public caller RPC definitions derive caller identity from auth.uid().
  select
    'video_date_phase5_public_rpc_definer_guards',
    pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
      like '%SECURITY DEFINER%'
    and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
      like '%v_viewer uuid := auth.uid()%'
    and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
      like '%v_viewer IS NULL OR v_viewer <> p_user_id%'
    and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
      like '%get_event_lobby_active_state(p_event_id, now())%'
    and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
      like '%COALESCE(er.admission_status, ''confirmed'') = ''confirmed''%'
    and pg_get_functiondef('public.get_video_date_queue_hint_v1(uuid,uuid)'::regprocedure)
      like '%SECURITY DEFINER%'
    and pg_get_functiondef('public.get_video_date_queue_hint_v1(uuid,uuid)'::regprocedure)
      like '%v_uid uuid := auth.uid()%'
    and pg_get_functiondef('public.get_video_date_queue_hint_v1(uuid,uuid)'::regprocedure)
      like '%v_uid IS NULL OR v_uid <> p_user_id%'
    and pg_get_functiondef('public.get_video_date_queue_hint_v1(uuid,uuid)'::regprocedure)
      like '%COALESCE(er.admission_status, ''confirmed'') = ''confirmed''%'
    and pg_get_functiondef('public.get_video_date_queue_hint_v1(uuid,uuid)'::regprocedure)
      like '%COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval ''10 minutes'') > now()%'

  union all

  -- 3) Payment status is caller-scoped and exposes checkout/refund state without a user-id parameter.
  select
    'video_date_phase5_payment_status_caller_scoped',
    pg_get_function_arguments('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      not like '%user%'
    and pg_get_function_arguments('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      not like '%profile%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%v_uid uuid := auth.uid()%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%er.profile_id = v_uid%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%i.user_id = v_uid%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%s.profile_id = v_uid%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%r.profile_id = v_uid%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%''checkout''%'
    and pg_get_functiondef('public.get_event_ticket_payment_status_v1(uuid)'::regprocedure)
      like '%''refund''%'

  union all

  -- 4) Snapshot core is participant-scoped and token-free.
  select
    'video_date_phase5_snapshot_core_participant_scoped',
    not has_function_privilege('anon', 'public.get_video_date_snapshot_core(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_video_date_snapshot_core(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_video_date_snapshot_core(uuid)', 'EXECUTE')
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      like '%v_uid uuid := auth.uid()%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      like '%v_uid IS DISTINCT FROM v_session.participant_1_id%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      like '%v_uid IS DISTINCT FROM v_session.participant_2_id%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      like '%''error'', ''not_participant''%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      not ilike '%meeting_token%'
    and pg_get_functiondef('public.get_video_date_snapshot_core(uuid)'::regprocedure)
      not ilike '%daily_token%'

  union all

  -- 5) Provider outbox and refund queue tables stay private to service_role.
  select
    'video_date_phase5_outbox_refund_tables_service_role_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'video_date_provider_outbox'
    )
    and not has_table_privilege('anon', 'public.video_date_provider_outbox', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_provider_outbox', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_date_provider_outbox', 'INSERT')
    and has_table_privilege('service_role', 'public.video_date_provider_outbox', 'SELECT')
    and has_table_privilege('service_role', 'public.video_date_provider_outbox', 'INSERT')
    and (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'stripe_event_ticket_refunds'
    )
    and not has_table_privilege('anon', 'public.stripe_event_ticket_refunds', 'SELECT')
    and not has_table_privilege('authenticated', 'public.stripe_event_ticket_refunds', 'SELECT')
    and not has_table_privilege('authenticated', 'public.stripe_event_ticket_refunds', 'INSERT')
    and has_table_privilege('service_role', 'public.stripe_event_ticket_refunds', 'SELECT')
    and has_table_privilege('service_role', 'public.stripe_event_ticket_refunds', 'INSERT')

  union all

  -- 6) Worker/internal mutation RPCs are not client executable.
  select
    'video_date_phase5_worker_rpcs_service_role_only',
    not has_function_privilege('anon', 'public.video_date_outbox_enqueue_v2(uuid,text,jsonb,text,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.video_date_outbox_enqueue_v2(uuid,text,jsonb,text,timestamp with time zone)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.video_date_outbox_enqueue_v2(uuid,text,jsonb,text,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_video_date_provider_outbox_v2(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_video_date_provider_outbox_v2(text,integer,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.claim_video_date_provider_outbox_v2(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_video_date_provider_outbox_v2(bigint,text,boolean,text,integer,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_video_date_provider_outbox_v2(bigint,text,boolean,text,integer,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_video_date_provider_outbox_v2(bigint,text,boolean,text,integer,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.enqueue_event_ticket_refund_v1(text,uuid,uuid,text,integer,text,text,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.enqueue_event_ticket_refund_v1(text,uuid,uuid,text,integer,text,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.enqueue_event_ticket_refund_v1(text,uuid,uuid,text,integer,text,text,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_event_ticket_refund_jobs_v1(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_event_ticket_refund_jobs_v1(text,integer,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.claim_event_ticket_refund_jobs_v1(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_event_ticket_refund_job_v1(uuid,text,boolean,text,text,text,integer,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_event_ticket_refund_job_v1(uuid,text,boolean,text,text,text,integer,boolean,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_event_ticket_refund_job_v1(uuid,text,boolean,text,text,text,integer,boolean,boolean)', 'EXECUTE')
)
select check_name, ok
from checks
order by check_name;
