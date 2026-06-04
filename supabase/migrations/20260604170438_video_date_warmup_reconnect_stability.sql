BEGIN;

DROP FUNCTION IF EXISTS public.video_date_transition_20260604170438_warmup_stability_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260604170438_warmup_stability_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260604170438_warmup_stability_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260604170438_warmup_stability_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_reason text := NULLIF(lower(btrim(COALESCE(p_reason, ''))), '');
  v_now timestamptz := clock_timestamp();
  v_warmup_window interval := interval '20 seconds';
  v_session public.video_sessions%ROWTYPE;
  v_recent_remote_seen boolean := false;
  v_recent_joined boolean := false;
  v_recent_handshake boolean := false;
  v_warmup_state boolean := false;
BEGIN
  IF v_action = 'mark_reconnect_partner_away'
     AND COALESCE(v_reason, '') <> 'daily_transport_grace_expired' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL THEN
      v_recent_remote_seen :=
        v_session.participant_1_remote_seen_at IS NOT NULL
        AND v_session.participant_2_remote_seen_at IS NOT NULL
        AND GREATEST(
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        ) >= v_now - v_warmup_window;

      v_recent_joined :=
        v_session.participant_1_joined_at IS NOT NULL
        AND v_session.participant_2_joined_at IS NOT NULL
        AND GREATEST(
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at
        ) >= v_now - v_warmup_window;

      v_recent_handshake :=
        v_session.handshake_started_at IS NOT NULL
        AND v_session.handshake_started_at >= v_now - v_warmup_window;

      v_warmup_state :=
        v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
        OR v_session.handshake_started_at IS NOT NULL
        OR v_session.date_started_at IS NOT NULL;

      IF v_warmup_state
         AND (v_recent_remote_seen OR v_recent_joined OR v_recent_handshake) THEN
        BEGIN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'mark_reconnect_partner_away_suppressed_transport_grace_pending',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', v_action,
              'p_reason', v_reason,
              'away_mark_suppressed', true,
              'daily_transport_grace_required', true,
              'warmup_window_seconds', extract(epoch from v_warmup_window)::integer,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'handshake_started_at', v_session.handshake_started_at
            )
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'state', v_session.state,
          'phase', v_session.phase,
          'ended', false,
          'partner_marked_away', false,
          'away_mark_suppressed', true,
          'suppression_reason', 'daily_transport_grace_required',
          'daily_transport_grace_required', true,
          'p_reason', v_reason,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'handshake_started_at', v_session.handshake_started_at
        );
      END IF;
    END IF;
  END IF;

  RETURN public.video_date_transition_20260604170438_warmup_stability_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date transition wrapper. Suppresses legacy/null immediate partner-away marks during fresh Daily warm-up evidence; explicit daily_transport_grace_expired still starts backend reconnect grace via the base transition.';

CREATE OR REPLACE FUNCTION public.record_video_date_client_stuck_observability(
  p_session_id uuid,
  p_event_name text,
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
  v_event_name text := lower(btrim(COALESCE(p_event_name, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_detail jsonb;
  v_rowcnt integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_event_name NOT IN (
    'ready_gate_handoff_slow',
    'prepare_date_entry_failed',
    'daily_join_confirmation_failed',
    'peer_missing_terminal',
    'peer_missing_suppressed_remote_seen',
    'peer_missing_suppressed_survey_truth',
    'native_background_recovery_started',
    'native_background_recovery_failed',
    'native_background_expired'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_event_name');
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

  v_latency_ms := CASE
    WHEN p_latency_ms IS NULL THEN NULL
    ELSE LEAST(86400000, GREATEST(0, p_latency_ms))
  END;

  v_outcome := CASE
    WHEN v_event_name IN (
      'prepare_date_entry_failed',
      'daily_join_confirmation_failed',
      'native_background_recovery_failed'
    ) THEN 'failure'
    WHEN v_event_name IN (
      'ready_gate_handoff_slow',
      'peer_missing_terminal',
      'native_background_expired'
    ) THEN 'timeout'
    ELSE 'success'
  END;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'client_event_name', v_event_name,
    'platform', CASE
      WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
      ELSE NULL
    END,
    'source', public.video_date_client_stuck_safe_text(v_payload->>'source'),
    'source_surface', public.video_date_client_stuck_safe_text(v_payload->>'source_surface'),
    'source_action', public.video_date_client_stuck_safe_text(v_payload->>'source_action'),
    'reason_code', public.video_date_client_stuck_safe_text(v_payload->>'reason_code'),
    'code', public.video_date_client_stuck_safe_text(v_payload->>'code'),
    'phase', public.video_date_client_stuck_safe_text(v_payload->>'phase'),
    'latency_bucket', public.video_date_client_stuck_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_client_stuck_safe_text(v_payload->>'entry_attempt_id'),
    'video_date_trace_id', public.video_date_client_stuck_safe_text(v_payload->>'video_date_trace_id'),
    'attempt', public.video_date_client_stuck_safe_int(v_payload->>'attempt', 0, 100),
    'attempt_count', public.video_date_client_stuck_safe_int(v_payload->>'attempt_count', 0, 100),
    'elapsed_ms', public.video_date_client_stuck_safe_int(v_payload->>'elapsed_ms', 0, 86400000),
    'duration_ms', public.video_date_client_stuck_safe_int(v_payload->>'duration_ms', 0, 86400000),
    'grace_ms', public.video_date_client_stuck_safe_int(v_payload->>'grace_ms', 0, 86400000),
    'watchdog_ms', public.video_date_client_stuck_safe_int(v_payload->>'watchdog_ms', 0, 86400000),
    'auto_recovery_count', public.video_date_client_stuck_safe_int(v_payload->>'auto_recovery_count', 0, 100),
    'http_status', public.video_date_client_stuck_safe_int(v_payload->>'http_status', 100, 599),
    'retryable', public.video_date_client_stuck_safe_bool(v_payload->>'retryable'),
    'exhausted', public.video_date_client_stuck_safe_bool(v_payload->>'exhausted'),
    'will_retry', public.video_date_client_stuck_safe_bool(v_payload->>'will_retry'),
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
    'video_date_client_stuck_state',
    v_outcome,
    v_event_name,
    v_latency_ms,
    v_session.event_id,
    v_actor,
    p_session_id,
    v_detail
  )
  ON CONFLICT (session_id, actor_id, operation, reason_code)
    WHERE operation = 'video_date_client_stuck_state'
    DO NOTHING;

  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_rowcnt = 1,
    'deduped', v_rowcnt = 0
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_client_stuck_observability(uuid, text, jsonb, integer) IS
  'Authenticated participant-only sparse client stuck-state audit ingestion for Video Date. Allows suppressed peer-missing diagnostics when server truth shows remote-seen or survey-required evidence.';

NOTIFY pgrst, 'reload schema';

COMMIT;
