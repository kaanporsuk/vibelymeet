-- Read-only validation pack for Ready Gate registration-desync terminalization.

-- Rebuild PR 4: the registration-desync layer is inlined into the single-body
-- head; the dated base generation is dropped.
with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_registration_desync_single_body_installed' as check_name,
  def like '%ready_gate_transition.single_body_core%'
  and def not like '%ready_gate_transition_20260505203000_registration_desync_base%'
  and def like '%registration_desync%'
  and def like '%missing_participant_registration%'
  and def like '%ready_gate_registration_desync%' as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_registration_desync_targets_only_pre_date_gates' as check_name,
  def like '%v_status NOT IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')%'
  and def like '%v_session.state IS DISTINCT FROM ''ready_gate''::public.video_date_state%'
  and def like '%v_session.handshake_started_at IS NOT NULL%'
  and def like '%v_session.date_started_at IS NOT NULL%'
  and def like '%v_session.daily_room_name IS NOT NULL%'
  and def like '%v_session.daily_room_url IS NOT NULL%'
  and def like '%v_session.participant_1_joined_at IS NOT NULL%'
  and def like '%v_session.participant_2_joined_at IS NOT NULL%'
  and def like '%COALESCE(v_session.phase, ''ready_gate'') IN (''handshake'', ''date'')%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_registration_desync_requires_both_registration_pointers' as check_name,
  def like '%er.profile_id = v_session.participant_1_id%'
  and def like '%er.profile_id = v_session.participant_2_id%'
  and def like '%er.queue_status = ''in_ready_gate''%'
  and def like '%er.current_room_id = p_session_id%'
  and def like '%IF NOT (v_p1_ready_gate AND v_p2_ready_gate) THEN%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_registration_desync_terminalizes_and_clears_registrations' as check_name,
  def like '%ready_gate_status = ''forfeited''%'
  and def like '%ended_reason = COALESCE(ended_reason, ''ready_gate_registration_desync'')%'
  and def like '%queue_status = ''idle''%'
  and def like '%current_room_id = NULL%'
  and def like '%current_partner_id = NULL%'
  and def like '%current_room_id = v_after.id%'
  and def like '%OR (queue_status = ''in_ready_gate'' AND current_room_id IS NULL)%'
  and def like '%''terminal'', true%'
  as ok
from fn;

-- Rebuild PR 4: the base generation must be gone; the head stays
-- authenticated + service_role only (anon has no EXECUTE — live posture).
with fns as (
  select
    to_regprocedure('public.ready_gate_transition(uuid,text,text)') as public_oid,
    to_regprocedure('public.ready_gate_transition_20260505203000_registration_desync_base(uuid,text,text)') as base_oid
)
select
  'ready_gate_registration_desync_grants_are_safe' as check_name,
  public_oid is not null
  and base_oid is null
  and not has_function_privilege('anon', public_oid, 'EXECUTE')
  and has_function_privilege('authenticated', public_oid, 'EXECUTE')
  and has_function_privilege('service_role', public_oid, 'EXECUTE')
  as ok
from fns;
