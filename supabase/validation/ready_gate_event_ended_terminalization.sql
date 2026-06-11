-- Read-only validation pack for Ready Gate event-ended terminalization.
-- Safe for production catalog verification after the migration is applied.

with fns as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'terminalize_event_ready_gates',
      'handle_event_ready_gate_terminalization',
      'ready_gate_transition',
      'video_date_transition',
      'confirm_video_date_entry_prepared'
    )
)
select
  'stream3_functions_exist_with_security_definer_search_path' as check_name,
  count(*) filter (where proname = 'terminalize_event_ready_gates' and args = 'p_event_id uuid, p_reason text') = 1
  and count(*) filter (where proname = 'handle_event_ready_gate_terminalization' and args = '') = 1
  and count(*) filter (where proname = 'ready_gate_transition' and args = 'p_session_id uuid, p_action text, p_reason text') = 1
  and count(*) filter (where proname = 'video_date_transition' and args = 'p_session_id uuid, p_action text, p_reason text') = 1
  and count(*) filter (where proname = 'confirm_video_date_entry_prepared' and args = 'p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text') = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public']) as ok
from fns;

with fn as (
  select pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure) as def
)
select
  'cleanup_targets_only_pre_date_ready_gate_statuses' as check_name,
  def like '%ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')%'
  and def like '%state = ''ready_gate''::public.video_date_state%'
  and def like '%ready_gate_status = ''expired''%'
  and def like '%ended_reason = v_terminal_reason%'
  and def like '%queue_status = ''idle''%'
  and def like '%current_room_id = NULL%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure) as def
)
select
  'cleanup_excludes_provider_prepared_and_date_capable_rows' as check_name,
  def like '%handshake_started_at IS NULL%'
  and def like '%date_started_at IS NULL%'
  and def like '%daily_room_name IS NULL%'
  and def like '%daily_room_url IS NULL%'
  and def like '%participant_1_joined_at IS NULL%'
  and def like '%participant_2_joined_at IS NULL%'
  and def like '%COALESCE(vs.phase, ''ready_gate'') NOT IN (''handshake'', ''date'')%'
  as ok
from fn;

select
  'event_lifecycle_trigger_invokes_cleanup' as check_name,
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'events'
      and t.tgname = 'events_terminalize_ready_gates_on_inactive'
      and not t.tgisinternal
      and p.proname = 'handle_event_ready_gate_terminalization'
  ) as ok;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_transition_detects_event_inactivity_under_locked_row' as check_name,
  position('FOR UPDATE' in def) > 0
  and position('v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id)' in def) > position('FOR UPDATE' in def)
  and def like '%p_action NOT IN (''sync'', ''mark_ready'', ''snooze'')%'
  and def like '%public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason)%'
  and def like '%''READY_GATE_EVENT_ENDED''%'
  and def like '%''inactive_reason'', v_inactive_reason%'
  as ok
from fn;

-- Retargeted to the single-body public function (PR 2: private chain dropped).
-- get_event_lobby_inactive_reason is called with v_ev (local variable holding
-- event_id), not v_session.event_id directly, in the single-body form.
with fn as (
  select pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) as def
)
select
  'video_date_transition_prepare_entry_rejects_inactive_events' as check_name,
  position('FOR UPDATE' in def) > 0
  and def like '%v_already_entry := (%'
  and def like '%public.get_event_lobby_inactive_reason(%'
  and def like '%public.terminalize_event_ready_gates(%'
  and def like '%''prepare_entry_event_inactive''%'
  and def like '%''code'', ''READY_GATE_NOT_READY''%'
  and def like '%''error_code'', ''EVENT_NOT_ACTIVE''%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.confirm_video_date_entry_prepared(uuid,text,text,text)'::regprocedure) as def
)
select
  'confirm_prepare_entry_rejects_inactive_unprepared_rows' as check_name,
  def like '%public.get_event_lobby_inactive_reason(v_session.event_id)%'
  and def like '%public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason)%'
  and def like '%''confirm_prepare_entry_event_inactive''%'
  and def like '%''code'', ''READY_GATE_NOT_READY''%'
  and def like '%''error_code'', ''EVENT_NOT_ACTIVE''%'
  and def like '%v_already_entry := (%'
  as ok
from fn;

with helper as (
  select to_regprocedure('public.terminalize_event_ready_gates(uuid,text)') as oid
), trig as (
  select to_regprocedure('public.handle_event_ready_gate_terminalization()') as oid
)
select
  'internal_helper_grants_are_safe' as check_name,
  helper.oid is not null
  and trig.oid is not null
  and not has_function_privilege('anon', helper.oid, 'EXECUTE')
  and not has_function_privilege('authenticated', helper.oid, 'EXECUTE')
  and not has_function_privilege('anon', trig.oid, 'EXECUTE')
  and not has_function_privilege('authenticated', trig.oid, 'EXECUTE')
  and has_function_privilege('service_role', helper.oid, 'EXECUTE')
from helper, trig;

-- private_video_date.vdt_event_inactive dropped in PR 2; the remaining two
-- archived base helpers must still exist and be non-client-executable.
with bases as (
  select unnest(array[
    to_regprocedure('public.ready_gate_transition_20260501200000_event_inactive_base(uuid,text,text)'),
    to_regprocedure('public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(uuid,text,text,text)')
  ]) as oid
)
select
  'renamed_base_functions_are_not_client_executable' as check_name,
  count(*) = 2
  and bool_and(oid is not null)
  and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
  and bool_and(not has_function_privilege('authenticated', oid, 'EXECUTE')) as ok
from bases;
