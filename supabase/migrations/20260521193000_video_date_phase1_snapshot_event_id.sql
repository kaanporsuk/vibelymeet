-- Phase 1 snapshot adoption: include eventId in the token-free snapshot core
-- so ready/date deep links can recover to the exact event lobby without a
-- second client-side video_sessions read.

CREATE OR REPLACE FUNCTION public.get_video_date_snapshot_core(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_at timestamptz;
  v_allowed text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_session.ready_gate_status = 'queued' THEN 'queued'
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
  INTO v_deadline_at
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

  IF v_deadline_at IS NULL THEN
    v_deadline_at := CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END;
  END IF;

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN ARRAY['submit_verdict']::text[]
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'handshake' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN ARRAY['submit_verdict', 'report_block']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'eventId', v_session.event_id,
    'seq', COALESCE(v_session.session_seq, 0),
    'serverNow', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    'phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'allowedActions', to_jsonb(v_allowed),
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_2_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_away_at) * 1000)::bigint END
      )
    ),
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'endedReason', v_session.ended_reason,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_snapshot_core(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_snapshot_core(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_snapshot_core(uuid) IS
  'Token-free video date snapshot with exact event recovery. Daily token minting stays in authorized Edge Functions that hold provider credentials.';
