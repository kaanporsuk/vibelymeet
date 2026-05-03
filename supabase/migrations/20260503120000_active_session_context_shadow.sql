-- Shadow-only active-session context for request-collapse parity checks.
-- This function is intentionally read-only and does not replace the existing
-- client-side active-session routing logic.

CREATE OR REPLACE FUNCTION public.get_active_session_context(
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration jsonb := NULL;
  v_current_session jsonb := NULL;
  v_open_sessions jsonb := '[]'::jsonb;
  v_recent_ended_sessions jsonb := '[]'::jsonb;
  v_feedback_session_ids jsonb := '[]'::jsonb;
  v_active_session jsonb := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'active_session', NULL,
      'registration', NULL,
      'current_session', NULL,
      'open_sessions', '[]'::jsonb,
      'recent_ended_sessions', '[]'::jsonb,
      'feedback_session_ids', '[]'::jsonb,
      'reason', 'missing_user'
    );
  END IF;

  SELECT to_jsonb(r)
  INTO v_registration
  FROM (
    SELECT
      er.event_id,
      er.current_room_id,
      er.queue_status,
      er.current_partner_id
    FROM public.event_registrations er
    WHERE er.profile_id = v_user_id
      AND er.queue_status IN ('in_handshake', 'in_date', 'in_survey', 'in_ready_gate')
      AND er.current_room_id IS NOT NULL
      AND (p_event_id IS NULL OR er.event_id = p_event_id)
    ORDER BY
      CASE er.queue_status
        WHEN 'in_handshake' THEN 0
        WHEN 'in_date' THEN 1
        WHEN 'in_ready_gate' THEN 2
        WHEN 'in_survey' THEN 3
        ELSE 4
      END,
      er.registered_at DESC NULLS LAST
    LIMIT 1
  ) r;

  IF v_registration IS NOT NULL THEN
    SELECT to_jsonb(vs)
    INTO v_current_session
    FROM (
      SELECT
        id,
        event_id,
        participant_1_id,
        participant_2_id,
        ended_at,
        ended_reason,
        state,
        phase,
        handshake_started_at,
        date_started_at,
        date_extra_seconds,
        ready_gate_status,
        ready_gate_expires_at,
        reconnect_grace_ends_at,
        started_at,
        state_updated_at,
        participant_1_joined_at,
        participant_2_joined_at,
        daily_room_name,
        daily_room_url
      FROM public.video_sessions
      WHERE id = (v_registration->>'current_room_id')::uuid
        AND (
          participant_1_id = v_user_id
          OR participant_2_id = v_user_id
        )
      LIMIT 1
    ) vs;

    IF v_current_session IS NOT NULL AND v_current_session->>'ended_at' IS NULL THEN
      v_active_session := jsonb_build_object(
        'kind',
          CASE
            WHEN v_registration->>'queue_status' = 'in_ready_gate' THEN 'ready_gate'
            ELSE 'video'
          END,
        'session_id', v_current_session->>'id',
        'event_id', v_registration->>'event_id',
        'queue_status', v_registration->>'queue_status'
      );
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_open_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      state,
      phase,
      handshake_started_at,
      date_started_at,
      date_extra_seconds,
      ready_gate_status,
      ready_gate_expires_at,
      reconnect_grace_ends_at,
      started_at,
      state_updated_at,
      participant_1_joined_at,
      participant_2_joined_at,
      daily_room_name,
      daily_room_url
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY handshake_started_at DESC NULLS LAST, ready_gate_expires_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_recent_ended_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      ended_reason,
      date_started_at,
      participant_1_joined_at,
      participant_2_joined_at,
      state,
      phase
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NOT NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY ended_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(df.session_id), '[]'::jsonb)
  INTO v_feedback_session_ids
  FROM public.date_feedback df
  WHERE df.user_id = v_user_id
    AND df.session_id IN (
      SELECT ended_vs.id
      FROM public.video_sessions ended_vs
      WHERE (ended_vs.participant_1_id = v_user_id OR ended_vs.participant_2_id = v_user_id)
        AND ended_vs.ended_at IS NOT NULL
        AND (p_event_id IS NULL OR ended_vs.event_id = p_event_id)
      ORDER BY ended_vs.ended_at DESC NULLS LAST
      LIMIT 10
    );

  IF v_active_session IS NULL AND jsonb_array_length(v_open_sessions) > 0 THEN
    v_current_session := v_open_sessions->0;
    v_active_session := jsonb_build_object(
      'kind',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'handshake_started_at', '') = ''
          THEN 'ready_gate'
          ELSE 'video'
        END,
      'session_id', v_current_session->>'id',
      'event_id', v_current_session->>'event_id',
      'queue_status',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'handshake_started_at', '') = ''
          THEN 'in_ready_gate'
          ELSE COALESCE(NULLIF(v_current_session->>'phase', ''), NULLIF(v_current_session->>'state', ''), 'in_handshake')
        END
    );
  END IF;

  RETURN jsonb_build_object(
    'active_session', v_active_session,
    'registration', v_registration,
    'current_session', v_current_session,
    'open_sessions', v_open_sessions,
    'recent_ended_sessions', v_recent_ended_sessions,
    'feedback_session_ids', v_feedback_session_ids,
    'reason', CASE WHEN v_active_session IS NULL THEN 'no_active_session_shadow_context' ELSE 'active_session_shadow_context' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_active_session_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_session_context(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_active_session_context(uuid) IS
  'Read-only shadow context for web active-session hydration parity checks. This function does not mutate state and is not authoritative for routing.';
