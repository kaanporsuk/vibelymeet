-- Additive expansion of the Video Date launch-latency allowlist for the
-- mutual-swipe-to-room-ready segment.
-- Migration classification: schema+policy.
--
-- Background:
--   The latency-checkpoint chain is:
--     public.record_video_date_launch_latency_checkpoint  (wrapper, 20260506102000)
--       └─ public.record_vd_launch_latency_202605061020_base  (inner; allowlist + insert)
--   The wrapper performs prepare-entry-timing decoration and is unchanged.
--   This migration only updates the INNER base to:
--     * Add new client-emittable checkpoints:
--         - mutual_swipe_observed         (lobby first sees the new session)
--         - room_pre_create_started       (early warmup begins on overlay mount)
--         - room_pre_create_success       (early warmup confirmed)
--         - room_pre_create_failure       (early warmup rejected / errored)
--         - date_route_module_preloaded   (route module finished resolving)
--     * Add `mutual_swipe_to_room_ready_ms` payload field for the segment
--       captured by item #1 (pre-create on mutual swipe).
--     * Add the system-vs-human metric split (item #15):
--         - human_wait_swipe_to_both_ready_ms
--         - system_latency_both_ready_to_first_remote_frame_ms
--         - date_route_module_preload_ms
--         - eligible_pre_create_status
--   Pure additive: no policy / state-machine change, sanitization unchanged,
--   ACLs unchanged (service_role-only on the inner base; the public wrapper
--   from 20260506102000 still issues the authenticated GRANT).

CREATE OR REPLACE FUNCTION public.record_vd_launch_latency_202605061020_base(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_own_ready_at timestamptz;
  v_peer_ready_at timestamptz;
  v_ready_actor_order text;
  v_detail jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_checkpoint NOT IN (
    'ready_gate_impression',
    'ready_tap',
    'ready_gate_transition_started',
    'ready_gate_transition_success',
    'both_ready_observed',
    'both_ready_observed_via_rpc_short_circuit',
    'mutual_swipe_observed',
    'room_pre_create_started',
    'room_pre_create_success',
    'room_pre_create_failure',
    'room_warmup_started',
    'room_warmup_success',
    'room_warmup_failure',
    'prepare_entry_started',
    'prepare_entry_success',
    'prepare_entry_failure',
    'provider_verify_started',
    'provider_verify_success',
    'provider_verify_skipped',
    'token_created',
    'navigation_started',
    'date_route_entered',
    'date_route_module_preloaded',
    'video_stage_shell_visible',
    'permission_check_started',
    'permission_check_success',
    'permission_check_skipped',
    'enter_handshake_started',
    'enter_handshake_success',
    'enter_handshake_failure',
    'daily_token_started',
    'daily_token_success',
    'daily_token_failure',
    'daily_join_started',
    'daily_join_success',
    'daily_join_failure',
    'local_video_ready',
    'remote_seen',
    'first_remote_frame',
    'remote_readable',
    'warmup_timer_started',
    'daily_prewarm_started',
    'daily_prewarm_camera_ready',
    'daily_prewarm_preauth_success',
    'daily_prewarm_join_started',
    'daily_prewarm_join_success',
    'daily_prewarm_join_failure',
    'daily_prewarm_solo_join_started',
    'daily_prewarm_solo_join_success',
    'daily_prewarm_solo_join_failure',
    'daily_prewarm_consumed',
    'daily_prewarm_fallback',
    'daily_prewarm_destroyed',
    'video_date_route_preload_started',
    'video_date_route_preload_success'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_checkpoint');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  IF v_session.participant_1_id = v_actor THEN
    v_own_ready_at := v_session.ready_participant_1_at;
    v_peer_ready_at := v_session.ready_participant_2_at;
  ELSE
    v_own_ready_at := v_session.ready_participant_2_at;
    v_peer_ready_at := v_session.ready_participant_1_at;
  END IF;

  v_ready_actor_order := CASE
    WHEN v_own_ready_at IS NULL OR v_peer_ready_at IS NULL THEN NULL
    WHEN v_own_ready_at <= v_peer_ready_at THEN 'first_ready'
    ELSE 'second_ready'
  END;

  v_latency_ms := CASE
    WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
    WHEN v_checkpoint = 'first_remote_frame' THEN
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
    WHEN v_checkpoint = 'room_pre_create_success' THEN
      public.video_date_launch_latency_safe_int(v_payload->>'mutual_swipe_to_room_ready_ms', 0, 86400000)
    WHEN v_checkpoint = 'date_route_module_preloaded' THEN
      public.video_date_launch_latency_safe_int(v_payload->>'date_route_module_preload_ms', 0, 86400000)
    ELSE COALESCE(
      public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
      public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
    )
  END;

  v_outcome := CASE
    WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
      THEN v_payload->>'outcome'
    WHEN v_checkpoint LIKE '%failure' THEN 'failure'
    ELSE 'success'
  END;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'client_event_name', 'ready_gate_to_date_latency_checkpoint',
    'checkpoint', v_checkpoint,
    'platform', CASE
      WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
      ELSE NULL
    END,
    'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
    'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
    'outcome', v_outcome,
    'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
    'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
    'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
    'ready_actor_order', COALESCE(v_ready_actor_order, public.video_date_launch_latency_safe_text(v_payload->>'ready_actor_order')),
    'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
    'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
    'ready_gate_open_to_ready_tap_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_gate_open_to_ready_tap_ms', 0, 86400000),
    'ready_tap_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_both_ready_ms', 0, 86400000),
    'ready_tap_to_prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_prepare_entry_ms', 0, 86400000),
    'ready_tap_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_date_route_ms', 0, 86400000),
    'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
    'ready_tap_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_remote_seen_ms', 0, 86400000),
    'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
    'mutual_swipe_to_room_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'mutual_swipe_to_room_ready_ms', 0, 86400000),
    'human_wait_swipe_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'human_wait_swipe_to_both_ready_ms', 0, 86400000),
    'system_latency_both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'system_latency_both_ready_to_first_remote_frame_ms', 0, 86400000),
    'date_route_module_preload_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_module_preload_ms', 0, 86400000),
    'both_ready_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_date_route_ms', 0, 86400000),
    'both_ready_to_daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_token_ms', 0, 86400000),
    'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
    'both_ready_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_remote_seen_ms', 0, 86400000),
    'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
    'both_ready_to_video_stage_shell_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_video_stage_shell_ms', 0, 86400000),
    'both_ready_to_local_video_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_local_video_ready_ms', 0, 86400000),
    'date_route_bootstrap_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_bootstrap_ms', 0, 86400000),
    'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
    'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
    'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
    'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
    'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
    'daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_ms', 0, 86400000),
    'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
    'room_warmup_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_warmup_ms', 0, 86400000),
    'prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_entry_ms', 0, 86400000),
    'provider_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'provider_verify_ms', 0, 86400000),
    'permission_check_ms', public.video_date_launch_latency_safe_int(v_payload->>'permission_check_ms', 0, 86400000),
    'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
    'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
    'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
    'eligible_pre_create_status', public.video_date_launch_latency_safe_text(v_payload->>'eligible_pre_create_status'),
    'observed_at', now()
  ));

  INSERT INTO public.event_loop_observability_events (
    operation,
    outcome,
    reason_code,
    latency_ms,
    event_id,
    actor_id,
    session_id,
    detail
  ) VALUES (
    'video_date_launch_latency_checkpoint',
    v_outcome,
    v_checkpoint,
    v_latency_ms,
    v_session.event_id,
    v_actor,
    p_session_id,
    v_detail
  );

  RETURN jsonb_build_object('ok', true, 'inserted', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_vd_launch_latency_202605061020_base(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.record_vd_launch_latency_202605061020_base(uuid, text, jsonb, integer) IS
  'Inner base for record_video_date_launch_latency_checkpoint. Allowlist now includes mutual_swipe_observed, room_pre_create_started/success/failure, date_route_module_preloaded, plus mutual_swipe_to_room_ready_ms / human_wait_swipe_to_both_ready_ms / system_latency_both_ready_to_first_remote_frame_ms / date_route_module_preload_ms / eligible_pre_create_status payload fields. Pure additive — same auth, sanitization, target table.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508160000',
  'Video date mutual-swipe-to-room-ready checkpoints + human/system metric split',
  'schema+policy',
  'Updates the inner record_vd_launch_latency_202605061020_base function with new checkpoints (mutual_swipe_observed, room_pre_create_started/success/failure, date_route_module_preloaded) and payload fields (mutual_swipe_to_room_ready_ms, human_wait_swipe_to_both_ready_ms, system_latency_both_ready_to_first_remote_frame_ms, date_route_module_preload_ms, eligible_pre_create_status). The public wrapper from 20260506102000 is unchanged. Pure additive: same allowlist behavior for previously-known checkpoints, same sanitization, same ACLs.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
