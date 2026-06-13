-- Read-only validation pack for Video Date prepare-entry lease.
-- Safe for production catalog verification after 20260503130000 is applied.

select
  'video_sessions_prepare_entry_lease_columns_exist' as check_name,
  count(*) filter (where column_name = 'prepare_entry_started_at' and is_nullable = 'YES') = 1
  and count(*) filter (where column_name = 'prepare_entry_expires_at' and is_nullable = 'YES') = 1
  and count(*) filter (where column_name = 'prepare_entry_attempt_id' and is_nullable = 'YES') = 1
  and count(*) filter (where column_name = 'prepare_entry_actor_id' and is_nullable = 'YES') = 1 as ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'video_sessions'
  and column_name in (
    'prepare_entry_started_at',
    'prepare_entry_expires_at',
    'prepare_entry_attempt_id',
    'prepare_entry_actor_id'
  );

select
  'prepare_entry_lease_index_exists' as check_name,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'video_sessions'
      and indexname = 'idx_video_sessions_prepare_entry_lease'
      and indexdef like '%prepare_entry_expires_at%'
      and indexdef like '%daily_room_name IS NULL%'
  ) as ok;

-- Retargeted to the single-body public function (PR 2: private chain dropped).
with fn as (
  select
    pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) as def,
    has_function_privilege('authenticated', 'public.video_date_transition(uuid,text,text)', 'EXECUTE') as auth_exec
)
select
  'video_date_transition_sets_non_routeable_prepare_lease' as check_name,
  def like '%prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now)%'
  and def like '%prepare_entry_expires_at = v_lease_expires_at%'
  and def like '%v_now + interval ''90 seconds''%'
  and def like '%ready_gate_expires_at = GREATEST(%'
  and def like '%prepare_entry_lease_started%'
  and def like '%prepare_entry_lease_refreshed%'
  and def like '%''routeable'', false%'
  and auth_exec as ok
from fn;

with fn as (
  select pg_get_functiondef('public.confirm_video_date_entry_prepared(uuid,text,text,text)'::regprocedure) as def
)
select
  'confirm_prepare_entry_clears_lease_after_success' as check_name,
  def like '%confirm_vde_prepared_202605031300_base%'
  and def like '%IF v_success THEN%'
  and def like '%prepare_entry_started_at = NULL%'
  and def like '%prepare_entry_expires_at = NULL%'
  and def like '%prepare_entry_attempt_id = NULL%'
  and def like '%prepare_entry_actor_id = NULL%' as ok
from fn;

-- Retargeted to the folded single body (review 1298-1305 / PR #1305): the
-- bounded alias and its *_202605031300_base helper were dropped and folded into
-- public.expire_stale_video_sessions(). Casting the dropped signature here used
-- to abort the whole pack with undefined_function under ON_ERROR_STOP.
with fn as (
  select pg_get_functiondef('public.expire_stale_video_sessions()'::regprocedure) as def
)
select
  'expire_cleanup_preserves_active_lease_and_terminalizes_expired_lease' as check_name,
  def like '%prepare_entry_expires_at > v_now%'
  and def like '%ready_gate_expires_at = prepare_entry_expires_at%'
  and def like '%prepare_entry_expires_at <= v_now%'
  and def like '%ended_reason = ''prepare_entry_timeout''%'
  and def like '%active_prepare_entry_lease_preserved%'
  and def like '%public.expire_stale_video_date_phases_bounded(%'
  and def like '%public.repair_stale_video_date_prepare_entries(%' as ok
from fn;

-- private_video_date.vdt_prepare_lease dropped in PR 2; the two archived base
-- helpers were folded into their single bodies and dropped (review 1298-1305 /
-- PR #1305): confirm_vde_prepared_202605031300_base ->
-- public.confirm_video_date_entry_prepared, and
-- expire_stale_video_sessions_bounded_202605031300_base ->
-- public.expire_stale_video_sessions().
select
  'renamed_prepare_lease_bases_are_folded_into_single_bodies' as check_name,
  to_regprocedure('public.confirm_vde_prepared_202605031300_base(uuid,text,text,text)') is null
  and to_regprocedure('public.expire_stale_video_sessions_bounded_202605031300_base(integer)') is null
  and to_regprocedure('public.confirm_video_date_entry_prepared(uuid,text,text,text)') is not null
  and to_regprocedure('public.expire_stale_video_sessions()') is not null as ok;
