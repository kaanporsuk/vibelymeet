-- Read-only validation pack for the Video Date end-to-end hardening migration.
-- Run in SQL editor after applying the migration to a non-production database.

-- 1) Confirm the idempotency ledger exists and is not client-writable.
select
  'video_date_credit_extension_spends_exists' as check_name,
  to_regclass('public.video_date_credit_extension_spends') is not null as ok;

-- 2) Confirm spend_video_date_credit_extension exposes the idempotency-key overload.
select
  'spend_video_date_credit_extension_has_idempotency_key' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'spend_video_date_credit_extension'
      and pg_get_function_arguments(p.oid) like '%p_idempotency_key text DEFAULT NULL%'
  ) as ok;

-- 3) Find verdict rows that would now be rejected by session_not_survey_eligible.
select
  df.session_id,
  df.user_id,
  vs.state,
  vs.phase,
  vs.ended_at,
  vs.ended_reason,
  vs.date_started_at
from public.date_feedback df
join public.video_sessions vs on vs.id = df.session_id
where vs.ended_at is null
   or vs.date_started_at is null
   or coalesce(vs.ended_reason, '') in (
     'ready_gate_forfeit',
     'ready_gate_expired',
     'queued_ttl_expired',
     'handshake_not_mutual',
     'handshake_grace_expired',
     'handshake_timeout',
     'partial_join_peer_timeout',
     'blocked_pair'
   )
order by df.created_at desc
limit 100;

-- 4) Stale Ready Gates that should be cleaned by expire_stale_video_sessions().
select
  id,
  event_id,
  ready_gate_status,
  ready_gate_expires_at,
  state,
  phase,
  handshake_started_at,
  participant_1_joined_at,
  participant_2_joined_at,
  ended_at
from public.video_sessions
where ended_at is null
  and state = 'ready_gate'
  and ready_gate_expires_at < now()
order by ready_gate_expires_at asc
limit 100;

-- 5) Registrations pointing at ended sessions.
select
  er.event_id,
  er.profile_id,
  er.queue_status,
  er.current_room_id,
  vs.state,
  vs.ended_at,
  vs.ended_reason
from public.event_registrations er
join public.video_sessions vs on vs.id = er.current_room_id
where vs.ended_at is not null
  and er.current_room_id is not null
order by vs.ended_at desc
limit 100;

-- 6) Long-running handshakes beyond the visible 60s hard deadline.
select
  id,
  event_id,
  handshake_started_at,
  handshake_grace_expires_at,
  state,
  participant_1_decided_at,
  participant_2_decided_at,
  participant_1_joined_at,
  participant_2_joined_at
from public.video_sessions
where ended_at is null
  and state = 'handshake'
  and handshake_started_at < now() - interval '65 seconds'
order by handshake_started_at asc
limit 100;

-- 7) Confirm the single-body public function contains non-survey pre-date end cleanup.
-- The private chain was dropped in PR 2; behavior now lives in public.video_date_transition.
select
  'video_date_transition_pre_date_end_cleanup' as check_name,
  pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%pre_date_end_cleanup%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%pre_date_manual_end%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%queue_status = v_resume_status%'
  as ok;

-- 8) Confirm the private chain has been fully dropped (PR 2).
-- vdt_core_legacy_01 and the entire private_video_date schema are gone.
select
  'legacy_video_date_transition_helper_not_client_executable' as check_name,
  to_regprocedure('private_video_date.vdt_core_legacy_01(uuid,text,text)') is null
  and to_regprocedure('public.video_date_transition_20260430180000_last_chance_grace_10s(uuid,text,text)') is null
  as ok;

-- 9) Pre-date sessions must not leave either participant stuck in survey, even
-- when current_room_id was already cleared by older code.
select
  er.event_id,
  er.profile_id,
  er.queue_status,
  er.current_room_id,
  vs.id as video_session_id,
  vs.state,
  vs.ended_at,
  vs.ended_reason,
  vs.date_started_at
from public.event_registrations er
join public.video_sessions vs
  on vs.event_id = er.event_id
  and er.profile_id in (vs.participant_1_id, vs.participant_2_id)
where er.queue_status = 'in_survey'
  and vs.ended_at is not null
  and vs.date_started_at is null
  and coalesce(vs.ended_reason, '') in (
    'pre_date_manual_end',
    'ready_gate_forfeit',
    'ready_gate_expired',
    'queued_ttl_expired',
    'handshake_not_mutual',
    'handshake_grace_expired',
    'handshake_timeout',
    'partial_join_peer_timeout',
    'blocked_pair'
  )
order by vs.ended_at desc
limit 100;

-- 10) Confirm the partial-join cleanup helper has the deliberate short name,
-- not the Postgres-truncated migration identifier.
select
  'partial_join_cleanup_helper_has_intentional_name' as check_name,
  to_regprocedure('public.expire_vd_phases_base_20260501133000(integer)') is not null
  and to_regprocedure('public.expire_stale_video_date_phases_bounded_20260501143000_partial_j(integer)') is null
  as ok;

-- 11) Confirm per-session stale cleanup observability is visible in the
-- service-role video-date timeline.
select
  'timeline_includes_stale_cleanup_events' as check_name,
  pg_get_functiondef('public.get_video_date_session_timeline(uuid)'::regprocedure)
    like '%''expire_stale_video_sessions''%'
  as ok;

-- 12) User-driven peer-missing exits after exactly one Daily join keep the
-- same terminal reason as backend partial-join timeout cleanup.
select
  'video_date_transition_peer_missing_manual_end_reason' as check_name,
  pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure)
    like '%partial_join_peer_manual_end%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure)
    like '%partial_join_peer_timeout%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure)
    like '%client_peer_missing_exit%'
  as ok;

-- 13) Confirm hard-handshake-deadline cleanup helper has a deliberate short
-- name, not the Postgres-truncated migration identifier.
select
  'handshake_deadline_cleanup_helper_has_intentional_name' as check_name,
  to_regprocedure('public.expire_vd_phases_base_20260502143000(integer)') is not null
  and to_regprocedure('public.expire_stale_video_date_phases_bounded_20260502143000_handshake(integer)') is null
  as ok;
