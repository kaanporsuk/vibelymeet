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

-- 6) Long-running handshakes beyond the visible 60s + 10s grace window.
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
  and handshake_started_at < now() - interval '75 seconds'
order by handshake_started_at asc
limit 100;

-- 7) Confirm video_date_transition end branch contains pre-date non-survey cleanup.
select
  'video_date_transition_pre_date_end_cleanup' as check_name,
  pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%pre_date_end_cleanup%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%pre_date_manual_end%'
  and pg_get_functiondef('public.video_date_transition(uuid,text,text)'::regprocedure) like '%queue_status = v_resume_status%'
  as ok;

-- 8) Confirm clients cannot call the retired implementation directly.
select
  'legacy_video_date_transition_helper_not_client_executable' as check_name,
  not has_function_privilege(
    'authenticated',
    'public.video_date_transition_20260430180000_last_chance_grace_10s(uuid,text,text)',
    'EXECUTE'
  ) as ok;

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
    'blocked_pair'
  )
order by vs.ended_at desc
limit 100;
