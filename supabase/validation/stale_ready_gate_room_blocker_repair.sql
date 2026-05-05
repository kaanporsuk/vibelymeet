-- Read-only validation for stale Ready Gate room-metadata blocker repair.
-- Safe for production catalog/state verification after the migration is applied.

with helper as (
  select
    pg_get_functiondef('public.video_session_blocks_global_active_conflict(uuid,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'video_session_blocks_global_active_conflict'
)
select
  'global_active_conflict_helper_ignores_stale_ready_gates' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public'])
  and bool_and(def like '%v_status = ''queued''%')
  and bool_and(def like '%p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now%')
  and bool_and(def like '%public.get_event_lobby_inactive_reason(p_event_id)%')
  and bool_and(def like '%p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now%') as ok
from helper;

with trig as (
  select pg_get_functiondef('public.enforce_one_active_video_session()'::regprocedure) as def
)
select
  'one_active_session_trigger_uses_global_helper' as check_name,
  def like '%public.video_session_blocks_global_active_conflict(%'
  and def like '%participant_has_active_session_conflict%'
  and def not like '%vs.ended_at IS NULL%AND vs.state IS DISTINCT FROM ''ended''%' as ok
from trig;

with cleanup as (
  select pg_get_functiondef('public.expire_stale_video_sessions_bounded(integer)'::regprocedure) as def
)
select
  'expire_cleanup_wraps_stale_room_metadata_repair' as check_name,
  def like '%public.terminalize_stale_pre_date_ready_gate_blockers(%'
  and def like '%expire_stale_vsessions_bounded_202605060900_base%' as ok
from cleanup;

select
  'stale_cleanup_base_name_is_not_truncated' as check_name,
  to_regprocedure('public.expire_stale_vsessions_bounded_202605060900_base(integer)') is not null
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'expire_stale_video_sessions_bounded_20260506090000_stale_room_b'
  ) as ok;

with repair as (
  select pg_get_functiondef('public.terminalize_stale_pre_date_ready_gate_blockers(integer,text)'::regprocedure) as def
)
select
  'stale_room_repair_terminalizes_pre_date_metadata_only' as check_name,
  def like '%daily_room_name = NULL%'
  and def like '%daily_room_url = NULL%'
  and def like '%prepare_entry_expires_at = NULL%'
  and def like '%handshake_started_at IS NULL%'
  and def like '%date_started_at IS NULL%'
  and def like '%participant_1_joined_at IS NULL%'
  and def like '%participant_2_joined_at IS NULL%'
  and def like '%stale_pre_date_ready_gate_room_metadata_terminalized%' as ok
from repair;

with event_cleanup as (
  select pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure) as def
)
select
  'event_ended_terminalization_allows_stale_room_metadata_cleanup' as check_name,
  def like '%daily_room_name = NULL%'
  and def like '%daily_room_url = NULL%'
  and def like '%stale_room_metadata_cleared%'
  and def not like '%vs.daily_room_name IS NULL%'
  and def not like '%vs.daily_room_url IS NULL%' as ok
from event_cleanup;

with swipe as (
  select pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'handle_swipe_global_preflight_returns_structured_conflict' as check_name,
  def like '%pre_swipe_global_active_session_guard%'
  and def like '%public.video_session_blocks_global_active_conflict(%'
  and def like '%handle_swipe_20260506090000_stale_room_base%'
  and position('RETURN public.handle_swipe_20260506090000_stale_room_base' in substring(
    def from position('pre_swipe_global_active_session_guard' in def)
  )) > 0
  and def like '%''outcome'', ''participant_has_active_session_conflict''%' as ok
from swipe;

select
  'no_nonended_expired_pre_date_room_metadata_blockers' as check_name,
  not exists (
    select 1
    from public.video_sessions vs
    where vs.ended_at is null
      and vs.state = 'ready_gate'::public.video_date_state
      and coalesce(vs.phase, 'ready_gate') not in ('handshake', 'date')
      and vs.ready_gate_status in ('ready', 'ready_a', 'ready_b', 'both_ready', 'queued')
      and vs.handshake_started_at is null
      and vs.date_started_at is null
      and vs.participant_1_joined_at is null
      and vs.participant_2_joined_at is null
      and (
        vs.daily_room_name is not null
        or vs.daily_room_url is not null
        or vs.daily_room_verified_at is not null
        or vs.daily_room_expires_at is not null
        or vs.daily_room_provider_verify_reason is not null
      )
      and (
        public.get_event_lobby_inactive_reason(vs.event_id) is not null
        or (
          vs.ready_gate_status = 'queued'
          and coalesce(vs.queued_expires_at, coalesce(vs.started_at, now()) + interval '10 minutes') <= now()
        )
        or (
          vs.ready_gate_status in ('ready', 'ready_a', 'ready_b', 'both_ready')
          and vs.ready_gate_expires_at is not null
          and vs.ready_gate_expires_at <= now()
          and (vs.prepare_entry_expires_at is null or vs.prepare_entry_expires_at <= now())
        )
      )
  ) as ok;
