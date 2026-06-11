-- Validation for Ready Gate stale pre-ready room metadata repair.

WITH fn AS (
  SELECT
    p.prosecdef,
    pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ready_gate_transition'
    AND pg_get_function_identity_arguments(p.oid) = 'p_session_id uuid, p_action text, p_reason text'
)
SELECT
  'ready_gate_transition_repair_signature_security' AS check_name,
  to_regprocedure('public.ready_gate_transition(uuid,text,text)') IS NOT NULL
    AND bool_and(prosecdef)
    -- live posture: authenticated + service_role only, no anon EXECUTE
    AND NOT has_function_privilege('anon', 'public.ready_gate_transition(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.ready_gate_transition(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.ready_gate_transition(uuid,text,text)', 'EXECUTE') AS ok
FROM fn;

-- Rebuild PR 4: the repair pass is inlined into the single-body head; the
-- chain layers (rgt_* short names, formerly the overlong dated bases) are gone.
WITH fn AS (
  SELECT pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) AS def
)
SELECT
  'ready_gate_transition_repair_is_single_body' AS check_name,
  def LIKE '%ready_gate_transition.single_body_core%'
    AND def NOT LIKE '%rgt_preserve_warmup_base_v1%'
    AND def NOT LIKE '%rgt_pre_ready_room_meta_base_v1%'
    AND to_regprocedure('public.rgt_preserve_warmup_base_v1(uuid,text,text)') IS NULL
    AND to_regprocedure('public.rgt_pre_ready_room_meta_base_v1(uuid,text,text)') IS NULL AS ok
FROM fn;

WITH fn AS (
  SELECT pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) AS def
)
SELECT
  'ready_gate_transition_repairs_only_participant_pre_date_ready_gate' AS check_name,
  def LIKE '%p_action IN (''mark_ready'', ''snooze'')%'
    AND def LIKE '%FOR UPDATE%'
    AND def LIKE '%v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor%'
    AND def LIKE '%v_session.ended_at IS NULL%'
    AND def LIKE '%v_session.state = ''ready_gate''::public.video_date_state%'
    AND def LIKE '%v_session.ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'')%'
    AND def LIKE '%v_session.handshake_started_at IS NULL%'
    AND def LIKE '%v_session.date_started_at IS NULL%'
    AND def LIKE '%v_session.participant_1_joined_at IS NULL%'
    AND def LIKE '%v_session.participant_2_joined_at IS NULL%' AS ok
FROM fn;

WITH fn AS (
  SELECT pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) AS def
)
SELECT
  'ready_gate_transition_clears_stale_room_metadata_only' AS check_name,
  def LIKE '%daily_room_name = NULL%'
    AND def LIKE '%daily_room_url = NULL%'
    AND def LIKE '%daily_room_verified_at = NULL%'
    AND def LIKE '%daily_room_expires_at = NULL%'
    AND def LIKE '%daily_room_provider_verify_reason = NULL%'
    AND def NOT LIKE '%ready_participant_1_at = NULL%'
    AND def NOT LIKE '%ready_participant_2_at = NULL%' AS ok
FROM fn;

WITH fn AS (
  SELECT pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) AS def
)
SELECT
  'ready_gate_transition_enriches_participant_safe_truth' AS check_name,
  def LIKE '%''participant_1_id'', v_session.participant_1_id%'
    AND def LIKE '%''participant_2_id'', v_session.participant_2_id%'
    AND def LIKE '%''ready_participant_1_at'', v_session.ready_participant_1_at%'
    AND def LIKE '%''ready_participant_2_at'', v_session.ready_participant_2_at%'
    AND def LIKE '%''ready_gate_status'', v_status%'
    AND def LIKE '%''ready_gate_expires_at'', v_session.ready_gate_expires_at%'
    AND def LIKE '%''snoozed_by'', v_session.snoozed_by%'
    AND def LIKE '%''snooze_expires_at'', v_session.snooze_expires_at%' AS ok
FROM fn;
