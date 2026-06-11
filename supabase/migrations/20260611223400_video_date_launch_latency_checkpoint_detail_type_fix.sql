-- ============================================================================
-- Video Date rebuild PR 5 follow-up: fix the folded
-- public.record_video_date_launch_latency_checkpoint from
-- 20260611215259_video_date_entry_vocab_flip_maintenance_single_bodies.
--
-- The failsoft-shell exception diagnostics variable `v_detail text` collided
-- with the checkpoint payload variable `v_detail jsonb` from the folded
-- insert layers, so every authenticated insert path failed the
-- event_loop_observability_events detail jsonb column (SQLSTATE 42804,
-- surfaced by `supabase db lint`). Diagnostics now use v_err_* names, and the
-- *_20260609105249_active_base 'checkpoint_failed' catch shape (dropped by
-- the fold) is restored around the dispatch core.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(p_session_id uuid, p_checkpoint text, p_payload jsonb DEFAULT '{}'::jsonb, p_latency_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;

  v_result jsonb;

  v_err_message text;

  v_err_detail text;

  v_err_hint text;

  v_session public.video_sessions%ROWTYPE;

  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));

  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;

  v_latency_ms integer;

  v_outcome text;

  v_detail jsonb;

  v_extra jsonb;

  v_own_ready_at timestamptz;

  v_peer_ready_at timestamptz;

  v_ready_actor_order text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- (fold of vd_launch_latency_20260609130139_hot_base ->
  --  record_vd_launch_lat_20260609105249_active_base ->
  --  record_vd_launch_latency_20260603150106_start_base ->
  --  *_202605252340 -> *_202605220240 -> *_202605061020)
  BEGIN
    <<dispatch>>
    BEGIN
    BEGIN -- (fold of *_20260609105249_active_base) checkpoint_failed catch
      IF v_checkpoint = 'swipe_result' THEN
        IF v_actor IS NULL THEN
          v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
          EXIT dispatch;
        END IF;

        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF NOT FOUND THEN
          v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
          EXIT dispatch;
        END IF;

        IF v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
          v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
          EXIT dispatch;
        END IF;

        v_latency_ms := COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
          CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        );

        v_outcome := CASE
          WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
            THEN v_payload->>'outcome'
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
          'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
          'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
          'swipe_result_ms', public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
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

        v_result := jsonb_build_object('ok', true, 'inserted', true);
        EXIT dispatch;
      END IF;

      BEGIN
        IF v_checkpoint IN (
          'daily_join_started',
          'daily_join_success',
          'daily_join_failure',
          'first_remote_frame'
        ) THEN
          IF v_actor IS NULL THEN
            v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
            EXIT dispatch;
          END IF;

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          IF NOT FOUND THEN
            v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
            EXIT dispatch;
          END IF;

          IF v_session.participant_1_id IS DISTINCT FROM v_actor
             AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
            v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
            EXIT dispatch;
          END IF;

          v_latency_ms := CASE
            WHEN v_checkpoint = 'first_remote_frame' THEN
              COALESCE(
                public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
              )
            WHEN v_checkpoint IN ('daily_join_success', 'daily_join_failure') THEN
              COALESCE(
                public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
              )
            ELSE
              COALESCE(
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
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
            'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
            'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
            'daily_performance_segment', CASE
              WHEN v_checkpoint LIKE 'daily_join_%' THEN 'daily_join'
              WHEN v_checkpoint = 'first_remote_frame' THEN 'first_remote_frame'
              ELSE public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment')
            END,
            'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
            'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
            'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
            'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
            'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
            'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
            'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
            'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
            'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
            'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
            'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
            'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
            'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
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

          v_result := jsonb_build_object('ok', true, 'inserted', true);
          EXIT dispatch;
        END IF;

        BEGIN
          IF v_checkpoint IN (
            'daily_room_create_started',
            'daily_room_create_success',
            'daily_room_create_failure',
            'daily_token_mint_started',
            'daily_token_mint_success',
            'daily_token_mint_failure',
            'daily_reconnect_started',
            'daily_reconnect_success',
            'daily_reconnect_failure',
            'extension_refresh_started',
            'extension_refresh_success',
            'extension_refresh_failure'
          ) THEN
            IF v_actor IS NULL THEN
              v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
              EXIT dispatch;
            END IF;

            SELECT *
            INTO v_session
            FROM public.video_sessions
            WHERE id = p_session_id;

            IF NOT FOUND THEN
              v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
              EXIT dispatch;
            END IF;

            IF v_session.participant_1_id IS DISTINCT FROM v_actor
               AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
              v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
              EXIT dispatch;
            END IF;

            v_latency_ms := CASE
              WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
              WHEN v_checkpoint IN ('daily_room_create_success', 'daily_room_create_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('extension_refresh_success', 'extension_refresh_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              ELSE
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
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
              'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
              'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
              'daily_performance_segment', public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment'),
              'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
              'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
              'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
              'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
              'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
              'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
              'extension_mode', public.video_date_launch_latency_safe_text(v_payload->>'extension_mode'),
              'credit_type', public.video_date_launch_latency_safe_text(v_payload->>'credit_type'),
              'extension_mutual', public.video_date_launch_latency_safe_bool(v_payload->>'extension_mutual'),
              'extension_awaiting_partner', public.video_date_launch_latency_safe_bool(v_payload->>'extension_awaiting_partner'),
              'extension_applied', public.video_date_launch_latency_safe_bool(v_payload->>'extension_applied'),
              'reconnect_source', public.video_date_launch_latency_safe_text(v_payload->>'reconnect_source'),
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

            v_result := jsonb_build_object('ok', true, 'inserted', true);
            EXIT dispatch;
          END IF;

              <<leafblk>>
              BEGIN
                IF v_actor IS NULL THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
                  EXIT leafblk;
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
                  v_result := jsonb_build_object('ok', false, 'error', 'unknown_checkpoint');
                  EXIT leafblk;
                END IF;

                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
                  EXIT leafblk;
                END IF;

                IF v_session.participant_1_id IS DISTINCT FROM v_actor
                   AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
                  EXIT leafblk;
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

                v_result := jsonb_build_object('ok', true, 'inserted', true);
                EXIT leafblk;
              EXCEPTION
                WHEN OTHERS THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
                  EXIT leafblk;      END;

          IF COALESCE((v_result->>'inserted')::boolean, false) AND v_actor IS NOT NULL THEN
            BEGIN
              v_extra := jsonb_strip_nulls(jsonb_build_object(
                'provider_verify_reason', public.video_date_launch_latency_safe_text(v_payload->>'provider_verify_reason'),
                'auth_ms', public.video_date_launch_latency_safe_int(v_payload->>'auth_ms', 0, 86400000),
                'prepare_rpc_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_rpc_ms', 0, 86400000),
                'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
                'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
                'confirm_prepare_ms', public.video_date_launch_latency_safe_int(v_payload->>'confirm_prepare_ms', 0, 86400000),
                'edge_total_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_total_ms', 0, 86400000),
                'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
                'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
                'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
                'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000)
              ));

              IF v_extra <> '{}'::jsonb THEN
                UPDATE public.event_loop_observability_events
                SET detail = detail || v_extra
                WHERE id = (
                  SELECT id
                  FROM public.event_loop_observability_events
                  WHERE operation = 'video_date_launch_latency_checkpoint'
                    AND actor_id = v_actor
                    AND session_id = p_session_id
                    AND reason_code = v_checkpoint
                  ORDER BY created_at DESC
                  LIMIT 1
                );
              END IF;
            EXCEPTION
              WHEN OTHERS THEN
                v_result := v_result;
                EXIT dispatch;
            END;
          END IF;

          v_result := v_result;
          EXIT dispatch;  EXCEPTION
          WHEN OTHERS THEN
            v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
        END;
        EXIT dispatch;
      EXCEPTION
        WHEN OTHERS THEN
          v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
      END;
      EXIT dispatch;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_message = MESSAGE_TEXT;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'checkpoint_failed',
          'error_code', 'CHECKPOINT_FAILED',
          'sqlstate', SQLSTATE,
          'message', v_err_message,
          'retryable', false
        );
        EXIT dispatch;
    END;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_err_message = MESSAGE_TEXT,
        v_err_detail = PG_EXCEPTION_DETAIL,
        v_err_hint = PG_EXCEPTION_HINT;

      BEGIN
        PERFORM public.video_date_lifecycle_observe_exception_v2(
          p_session_id,
          v_actor,
          'record_video_date_launch_latency_checkpoint.hot_path_shell',
          SQLSTATE,
          v_err_message,
          v_err_detail,
          v_err_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'rpc', 'record_video_date_launch_latency_checkpoint',
        'checkpoint', lower(btrim(COALESCE(p_checkpoint, ''))),
        'error', 'launch_latency_checkpoint_failed',
        'reason', 'launch_latency_checkpoint_failed',
        'code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
        'error_code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
        'retryable', true,
        'terminal', false,
        'hot_path_no_throw_shell', true,
        'active_entry_failsoft_shell', true,
        'last_resort_payload', true,
        'sqlstate', SQLSTATE,
        'sql_message', left(COALESCE(v_err_message, ''), 500)
      );
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'hot_path_no_throw_shell', true,
    'active_entry_failsoft_shell', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_err_message = MESSAGE_TEXT,
      v_err_detail = PG_EXCEPTION_DETAIL,
      v_err_hint = PG_EXCEPTION_HINT;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'record_video_date_launch_latency_checkpoint',
      'checkpoint', lower(btrim(COALESCE(p_checkpoint, ''))),
      'error', 'launch_latency_checkpoint_failed',
      'reason', 'launch_latency_checkpoint_failed',
      'code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'error_code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'retryable', true,
      'terminal', false,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'sqlstate', SQLSTATE,
      'sql_message', left(COALESCE(v_err_message, ''), 500)
    );
END;
$function$;
