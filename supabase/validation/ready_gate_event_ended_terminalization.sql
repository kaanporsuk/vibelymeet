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
  -- single-body heads pin search_path = public, pg_catalog; the helpers keep
  -- search_path = public
  and bool_and(proconfig::text like '%search_path=public%') as ok
from fns;

-- terminalize_event_ready_gates selects pre-date gates and delegates each row
-- to the shared per-session owner video_date_terminalize_ready_gate_session_v1,
-- which owns the terminal status mapping and registration clearing.
with sweep as (
  select pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure) as def
), owner as (
  select pg_get_functiondef('public.video_date_terminalize_ready_gate_session_v1(uuid,uuid,text,jsonb)'::regprocedure) as def
)
select
  'cleanup_targets_only_pre_date_ready_gate_statuses' as check_name,
  (select def like '%ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')%' from sweep)
  and (select def like '%state = ''ready_gate''::public.video_date_state%' from sweep)
  and (select def like '%video_date_terminalize_ready_gate_session_v1%' from sweep)
  and (select def like '%ready_gate_status = v_terminal_status%' from owner)
  and (select def like '%THEN ''expired''%' from owner)
  and (select def like '%queue_status = ''idle''%' from owner)
  and (select def like '%current_room_id = NULL%' from owner)
  as ok;

-- Daily room metadata alone is intentionally NOT date-capable evidence; the
-- sweep excludes only handshake/date ownership and concrete join proof.
with fn as (
  select pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure) as def
)
select
  'cleanup_excludes_provider_prepared_and_date_capable_rows' as check_name,
  def like '%handshake_started_at IS NULL%'
  and def like '%date_started_at IS NULL%'
  and def like '%participant_1_joined_at IS NULL%'
  and def like '%participant_2_joined_at IS NULL%'
  and def like '%COALESCE(vs.phase, ''ready_gate'') NOT IN (''handshake'', ''date'')%'
  and def like '%room_metadata_not_provider_prepared_evidence%'
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
  -- Rebuild PR 4 single body: the terminalization decision (not the read-only
  -- sync fast path) happens under the locked session row.
  and position('public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason)' in def) > position('FOR UPDATE' in def)
  and def like '%p_action IN (''sync'', ''mark_ready'', ''snooze'')%'
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

-- The confirm fn is a single body since the VD-rebuild generation drops; it
-- owns the event-inactive rejection path directly.
with fn as (
  select pg_get_functiondef('public.confirm_video_date_entry_prepared(uuid,text,text,text)'::regprocedure) as def
)
select
  'confirm_prepare_entry_rejects_inactive_unprepared_rows' as check_name,
  def like '%public.get_event_lobby_inactive_reason(v_session.event_id)%'
  and def like '%public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason)%'
  and def like '%''confirm_prepare_entry_event_inactive''%'
  and def like '%READY_GATE_NOT_READY%'
  and def like '%EVENT_NOT_ACTIVE%'
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
  and has_function_privilege('service_role', helper.oid, 'EXECUTE') as ok
from helper, trig;

-- private_video_date.vdt_event_inactive dropped in PR 2;
-- ready_gate_transition_20260501200000_event_inactive_base inlined and dropped
-- in rebuild PR 4. The confirm-entry base (short-renamed by identifier hygiene
-- to confirm_vde_event_inactive_base_v1) must still exist and stay
-- non-client-executable.
with dropped as (
  select to_regprocedure('public.ready_gate_transition_20260501200000_event_inactive_base(uuid,text,text)') as oid
), confirm_base as (
  select to_regprocedure('public.confirm_vde_event_inactive_base_v1(uuid,text,text,text)') as oid
)
select
  'event_inactive_bases_match_single_body_posture' as check_name,
  (select oid is null from dropped)
  and (select oid is not null from confirm_base)
  and not has_function_privilege('anon', (select oid from confirm_base), 'EXECUTE')
  and not has_function_privilege('authenticated', (select oid from confirm_base), 'EXECUTE') as ok;
