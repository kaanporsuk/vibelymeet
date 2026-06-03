-- Keep the canonical Video Date startup snapshot payload below Postgres'
-- jsonb_build_object argument limit. The prior migration installed the correct
-- semantics, but its participant success path built too many key/value pairs in
-- one call. This replacement preserves the shape and chunks the final payload.

CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_server_now_ms bigint;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_deadline_at timestamptz;
  v_actor_role text;
  v_partner_id uuid;
  v_ready_gate_status text;
  v_i_am_ready boolean := false;
  v_partner_ready boolean := false;
  v_is_participant boolean := false;
  v_is_blocked boolean := false;
  v_inactive_reason text := NULL;
  v_can_mark_ready boolean := false;
  v_can_enter_date boolean := false;
  v_terminal boolean := false;
  v_retryable boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_is_participant :=
    v_uid = v_session.participant_1_id
    OR v_uid = v_session.participant_2_id;

  IF NOT v_is_participant THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'error_code', 'NOT_PARTICIPANT',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');

  BEGIN
    v_is_blocked := public.is_blocked(v_session.participant_1_id, v_session.participant_2_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'blocked_pair_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'safety_check_unavailable',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'auxiliary_errors', v_auxiliary_errors,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF v_is_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'viewer_role', CASE
        WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
        ELSE 'participant_2'
      END,
      'partner_id', CASE
        WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END,
      'error', 'blocked_pair',
      'error_code', 'BLOCKED_PAIR',
      'reason', 'blocked_pair',
      'ended_reason', 'blocked_pair',
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'can_mark_ready', false,
      'can_enter_date', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'event_active_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      v_inactive_reason := NULL;
  END;

  v_actor_role := CASE
    WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
    WHEN v_uid = v_session.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_partner_id := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;
  v_i_am_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_1_at IS NOT NULL
    ELSE v_session.ready_participant_2_at IS NOT NULL
  END;
  v_partner_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_2_at IS NOT NULL
    ELSE v_session.ready_participant_1_at IS NOT NULL
  END;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_deadline_at := COALESCE(
    v_deadline_row_at,
    CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END
  );

  v_terminal :=
    v_session.ended_at IS NOT NULL
    OR v_session.state::text = 'ended'
    OR v_ready_gate_status IN ('both_ready', 'expired', 'forfeited', 'cancelled', 'ended');

  v_can_mark_ready :=
    v_inactive_reason IS NULL
    AND v_session.ended_at IS NULL
    AND v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      v_session.ready_gate_expires_at IS NULL
      OR v_session.ready_gate_expires_at > v_now
      OR v_ready_gate_status = 'snoozed'
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snooze_expires_at IS NULL
      OR v_session.snooze_expires_at > v_now
    );

  v_can_enter_date :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_session.date_started_at IS NOT NULL
      OR v_session.state::text = 'date'
      OR v_ready_gate_status = 'both_ready'
    )
    AND v_session.daily_room_name IS NOT NULL
    AND v_session.daily_room_url IS NOT NULL;

  v_retryable :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed');

  v_allowed := CASE
    WHEN v_can_mark_ready THEN ARRAY['mark_ready', 'forfeit']::text[]
    WHEN v_can_enter_date THEN ARRAY['enter_date']::text[]
    WHEN v_ready_gate_status = 'both_ready' THEN ARRAY['enter_date']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN
    jsonb_build_object(
      'ok', true,
      'success', true,
      'snapshot', true,
      'source', 'get_video_date_start_snapshot_v1',
      'session_id', v_session.id,
      'sessionId', v_session.id,
      'event_id', v_session.event_id,
      'eventId', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'partnerId', v_partner_id,
      'viewer_id', v_uid,
      'viewerId', v_uid,
      'actor_role', v_actor_role,
      'actorRole', v_actor_role,
      'viewer_role', v_actor_role,
      'viewerRole', v_actor_role,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'state', v_session.state,
      'phase', v_session.phase,
      'normalized_phase', v_phase,
      'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
      'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
      'seq', COALESCE(v_session.session_seq, 0),
      'session_seq', COALESCE(v_session.session_seq, 0)
    )
    || jsonb_build_object(
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at,
      'i_am_ready', v_i_am_ready,
      'iAmReady', v_i_am_ready,
      'partner_ready', v_partner_ready,
      'partnerReady', v_partner_ready,
      'is_both_ready', v_ready_gate_status = 'both_ready',
      'isBothReady', v_ready_gate_status = 'both_ready',
      'handshake_started_at', v_session.handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
    )
    || jsonb_build_object(
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'room', CASE
        WHEN v_session.daily_room_url IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', v_session.daily_room_name,
          'url', v_session.daily_room_url,
          'tokenRequired', true
        )
      END,
      'ended_at', v_session.ended_at,
      'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END,
      'ended_reason', v_session.ended_reason,
      'endedReason', v_session.ended_reason,
      'inactive_reason', v_inactive_reason,
      'inactiveReason', v_inactive_reason
    )
    || jsonb_build_object(
      'can_mark_ready', v_can_mark_ready,
      'canMarkReady', v_can_mark_ready,
      'can_enter_date', v_can_enter_date,
      'canEnterDate', v_can_enter_date,
      'terminal', v_terminal,
      'retryable', v_retryable,
      'allowedActions', to_jsonb(v_allowed),
      'auxiliary_errors', v_auxiliary_errors,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms,
      'serverNow', v_server_now_ms
    );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'start_snapshot_failed',
      'error_code', 'START_SNAPSHOT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) IS
  'Participant-safe Video Date startup snapshot for Ready Gate/web/native startup. The success payload is chunked to stay below jsonb_build_object argument limits.';

NOTIFY pgrst, 'reload schema';
