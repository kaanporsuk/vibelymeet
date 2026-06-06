BEGIN;

CREATE TABLE IF NOT EXISTS public.video_date_presence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  actor_id uuid,
  source text NOT NULL,
  event_type text NOT NULL,
  owner_id text,
  call_instance_id text,
  provider_session_id text,
  entry_attempt_id text,
  owner_state text,
  surface_client_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS video_date_presence_events_session_actor_idx
  ON public.video_date_presence_events (session_id, actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS video_date_presence_events_session_type_idx
  ON public.video_date_presence_events (session_id, event_type, occurred_at DESC);

ALTER TABLE public.video_date_presence_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_date_presence_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.video_date_presence_events TO service_role;

COMMENT ON TABLE public.video_date_presence_events IS
  'Append-only Video Date presence ledger. Clients write through RPCs; service role can inspect provider/client owner evidence for diagnostics.';

CREATE OR REPLACE FUNCTION public.video_date_stable_copresence_v1(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_latest_joined_at timestamptz;
  v_participant_1_first_heartbeat_at timestamptz;
  v_participant_1_heartbeat_at timestamptz;
  v_participant_2_first_heartbeat_at timestamptz;
  v_participant_2_heartbeat_at timestamptz;
  v_latest_heartbeat_at timestamptz;
  v_copresence_since_at timestamptz;
  v_remote_seen boolean := false;
  v_stable boolean := false;
  v_waiting boolean := true;
  v_reason text := 'missing_session';
BEGIN
  SELECT * INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'stable_copresence', false,
      'waiting_for_stable_copresence', true,
      'reason', v_reason,
      'retry_after_ms', 750
    );
  END IF;

  v_participant_1_active := public.video_date_latest_presence_is_active(
    v_row.participant_1_joined_at,
    v_row.participant_1_away_at
  );
  v_participant_2_active := public.video_date_latest_presence_is_active(
    v_row.participant_2_joined_at,
    v_row.participant_2_away_at
  );

  IF v_row.participant_1_joined_at IS NOT NULL
     AND v_row.participant_2_joined_at IS NOT NULL THEN
    v_latest_joined_at := GREATEST(
      v_row.participant_1_joined_at,
      v_row.participant_2_joined_at
    );
  END IF;

  IF v_latest_joined_at IS NOT NULL THEN
    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_1_first_heartbeat_at, v_participant_1_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_1_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_latest_joined_at;

    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_2_first_heartbeat_at, v_participant_2_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_2_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_latest_joined_at;
  END IF;

  IF v_participant_1_heartbeat_at IS NOT NULL
     AND v_participant_2_heartbeat_at IS NOT NULL THEN
    v_latest_heartbeat_at := GREATEST(
      v_participant_1_heartbeat_at,
      v_participant_2_heartbeat_at
    );
    v_copresence_since_at := GREATEST(
      v_participant_1_first_heartbeat_at,
      v_participant_2_first_heartbeat_at
    );
  END IF;

  v_remote_seen :=
    v_row.participant_1_remote_seen_at IS NOT NULL
    AND v_row.participant_2_remote_seen_at IS NOT NULL
    AND (
      v_row.participant_1_away_at IS NULL
      OR v_row.participant_1_remote_seen_at >= v_row.participant_1_away_at
    )
    AND (
      v_row.participant_2_away_at IS NULL
      OR v_row.participant_2_remote_seen_at >= v_row.participant_2_away_at
    );

  IF v_row.date_started_at IS NOT NULL
     OR v_row.state = 'date'::public.video_date_state
     OR v_row.phase = 'date' THEN
    v_stable := true;
    v_reason := 'already_date';
  ELSIF v_remote_seen THEN
    v_stable := true;
    v_reason := 'remote_seen';
  ELSIF NOT v_participant_1_active OR NOT v_participant_2_active THEN
    v_reason := 'latest_joined_not_active';
  ELSIF v_latest_joined_at IS NULL THEN
    v_reason := 'missing_joined_evidence';
  ELSIF v_participant_1_heartbeat_at IS NULL
        OR v_participant_2_heartbeat_at IS NULL THEN
    v_reason := 'missing_owner_heartbeat_after_latest_join';
  ELSIF v_participant_1_heartbeat_at < v_now - interval '15 seconds'
        OR v_participant_2_heartbeat_at < v_now - interval '15 seconds' THEN
    v_reason := 'owner_heartbeat_stale';
  ELSIF v_copresence_since_at <= v_now - interval '2 seconds' THEN
    v_stable := true;
    v_reason := 'stable_owner_heartbeat';
  ELSE
    v_reason := 'owner_heartbeat_stabilizing';
  END IF;

  v_waiting := NOT v_stable;

  RETURN jsonb_build_object(
    'stable_copresence', v_stable,
    'waiting_for_stable_copresence', v_waiting,
    'reason', v_reason,
    'retry_after_ms', CASE WHEN v_waiting THEN 750 ELSE 0 END,
    'latest_joined_at', v_latest_joined_at,
    'latest_owner_heartbeat_at', v_latest_heartbeat_at,
    'stable_copresence_since_at', v_copresence_since_at,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_1_active', v_participant_1_active,
    'participant_1_first_owner_heartbeat_at', v_participant_1_first_heartbeat_at,
    'participant_1_owner_heartbeat_at', v_participant_1_heartbeat_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'participant_2_first_owner_heartbeat_at', v_participant_2_first_heartbeat_at,
    'participant_2_owner_heartbeat_at', v_participant_2_heartbeat_at,
    'remote_seen', v_remote_seen
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_stable_copresence_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_stable_copresence_v1(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_started_handshake boolean := false;
  v_routeable boolean := false;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_latest_joined_at timestamptz;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_ended');
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_routeable :=
    v_row.ready_gate_status = 'both_ready'
    AND (
      v_row.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
      OR v_row.phase IN ('handshake', 'date')
      OR v_row.handshake_started_at IS NOT NULL
      OR v_row.date_started_at IS NOT NULL
    );

  IF NOT v_routeable THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_routeable',
      'ready_gate_status', v_row.ready_gate_status,
      'state', v_row.state,
      'phase', v_row.phase
    );
  END IF;

  v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

  IF v_uid = v_row.participant_1_id THEN
    UPDATE public.video_sessions
    SET
      participant_1_joined_at = CASE
        WHEN public.video_date_latest_presence_is_active(participant_1_joined_at, participant_1_away_at)
          THEN participant_1_joined_at
        ELSE GREATEST(COALESCE(participant_1_joined_at, v_now), v_now)
      END,
      participant_1_away_at = NULL,
      reconnect_grace_ends_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET
      participant_2_joined_at = CASE
        WHEN public.video_date_latest_presence_is_active(participant_2_joined_at, participant_2_away_at)
          THEN participant_2_joined_at
        ELSE GREATEST(COALESCE(participant_2_joined_at, v_now), v_now)
      END,
      participant_2_away_at = NULL,
      reconnect_grace_ends_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id;
  END IF;

  INSERT INTO public.video_date_presence_events (
    session_id,
    actor_id,
    source,
    event_type,
    owner_state,
    occurred_at,
    details
  ) VALUES (
    p_session_id,
    v_uid,
    'mark_video_date_daily_joined',
    'owner_heartbeat',
    'joined',
    v_now,
    jsonb_build_object('rpc', 'mark_video_date_daily_joined')
  );

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

  v_latest_joined_at := CASE
    WHEN v_uid = v_row.participant_1_id THEN v_row.participant_1_joined_at
    ELSE v_row.participant_2_joined_at
  END;

  IF v_reconnect_grace_cleared THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'reconnect_grace_cleared_by_daily_join',
      NULL,
      v_row.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_video_date_daily_joined',
        'latest_joined_at', v_latest_joined_at,
        'reconnect_grace_cleared', true,
        'participant_1_joined_at', v_row.participant_1_joined_at,
        'participant_2_joined_at', v_row.participant_2_joined_at,
        'participant_1_away_at', v_row.participant_1_away_at,
        'participant_2_away_at', v_row.participant_2_away_at
      )
    );
  END IF;

  v_participant_1_active := public.video_date_latest_presence_is_active(
    v_row.participant_1_joined_at,
    v_row.participant_1_away_at
  );
  v_participant_2_active := public.video_date_latest_presence_is_active(
    v_row.participant_2_joined_at,
    v_row.participant_2_away_at
  );
  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_stable_copresence THEN
    UPDATE public.video_sessions
    SET
      handshake_started_at = v_now,
      state = 'handshake'::public.video_date_state,
      phase = 'handshake',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
    RETURNING * INTO v_row;

    IF FOUND THEN
      v_started_handshake := true;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_started_after_stable_copresence',
        NULL,
        v_row.event_id,
        v_uid,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_daily_joined',
          'handshake_started_at', v_row.handshake_started_at,
          'stable_copresence', v_stable,
          'active_presence_required', true,
          'stable_copresence_required', true
        )
      );
    ELSE
      SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
    END IF;
  ELSIF v_row.date_started_at IS NULL
        AND v_row.handshake_started_at IS NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'daily_join_waiting_for_stable_copresence',
      NULL,
      v_row.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_video_date_daily_joined',
        'stable_copresence', v_stable,
        'participant_1_joined_at', v_row.participant_1_joined_at,
        'participant_1_away_at', v_row.participant_1_away_at,
        'participant_1_active', v_participant_1_active,
        'participant_2_joined_at', v_row.participant_2_joined_at,
        'participant_2_away_at', v_row.participant_2_away_at,
        'participant_2_active', v_participant_2_active,
        'stable_copresence_required', true
      )
    );
  END IF;

  v_status := CASE
    WHEN v_row.date_started_at IS NOT NULL
      OR v_row.state = 'date'::public.video_date_state
      OR v_row.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
      ELSE v_row.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_row.event_id
    AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id);

  RETURN jsonb_build_object(
    'ok', true,
    'queue_status', v_status,
    'handshake_started', v_started_handshake,
    'handshake_started_at', v_row.handshake_started_at,
    'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
    'stable_copresence', v_stable,
    'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
    'latest_joined_at', v_latest_joined_at,
    'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
    'reconnect_grace_cleared', v_reconnect_grace_cleared,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_1_active', v_participant_1_active,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'active_presence_required', true,
    'stable_copresence_required', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid)
  TO service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid) IS
  'Private base for mark_video_date_daily_joined fail-soft wrapper. Stamps latest Daily joined evidence and starts handshake only after stable owner-heartbeat copresence or remote_seen media proof.';

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_routeable boolean := false;
  v_started_handshake boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_actor_active boolean := false;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unauthorized',
      'retryable', false
    );
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_found',
      'retryable', false
    );
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'session_ended',
      'retryable', false
    );
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'forbidden',
      'retryable', false
    );
  END IF;

  v_routeable :=
    v_row.ready_gate_status = 'both_ready'
    AND (
      v_row.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
      OR v_row.phase IN ('handshake', 'date')
      OR v_row.handshake_started_at IS NOT NULL
      OR v_row.date_started_at IS NOT NULL
    );

  IF NOT v_routeable THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_routeable',
      'retryable', true,
      'retry_after_ms', 750,
      'ready_gate_status', v_row.ready_gate_status,
      'state', v_row.state,
      'phase', v_row.phase
    );
  END IF;

  v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

  IF v_uid = v_row.participant_1_id THEN
    v_actor_active := public.video_date_latest_presence_is_active(
      v_row.participant_1_joined_at,
      v_row.participant_1_away_at
    );
    IF NOT v_actor_active THEN
      UPDATE public.video_sessions
      SET
        participant_1_joined_at = GREATEST(COALESCE(participant_1_joined_at, v_now), v_now),
        participant_1_away_at = NULL,
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    ELSIF v_row.reconnect_grace_ends_at IS NOT NULL THEN
      UPDATE public.video_sessions
      SET
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    END IF;
  ELSE
    v_actor_active := public.video_date_latest_presence_is_active(
      v_row.participant_2_joined_at,
      v_row.participant_2_away_at
    );
    IF NOT v_actor_active THEN
      UPDATE public.video_sessions
      SET
        participant_2_joined_at = GREATEST(COALESCE(participant_2_joined_at, v_now), v_now),
        participant_2_away_at = NULL,
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    ELSIF v_row.reconnect_grace_ends_at IS NOT NULL THEN
      UPDATE public.video_sessions
      SET
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    END IF;
  END IF;

  INSERT INTO public.video_date_presence_events (
    session_id,
    actor_id,
    source,
    event_type,
    owner_id,
    call_instance_id,
    provider_session_id,
    entry_attempt_id,
    owner_state,
    occurred_at,
    details
  ) VALUES (
    p_session_id,
    v_uid,
    'mark_video_date_daily_alive',
    'client_daily_alive',
    NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''),
    v_now,
    jsonb_build_object(
      'rpc', 'mark_video_date_daily_alive',
      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
      'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
      'owner_state', NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), '')
    )
  );

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

  v_participant_1_active := public.video_date_latest_presence_is_active(
    v_row.participant_1_joined_at,
    v_row.participant_1_away_at
  );
  v_participant_2_active := public.video_date_latest_presence_is_active(
    v_row.participant_2_joined_at,
    v_row.participant_2_away_at
  );

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_stable_copresence THEN
    UPDATE public.video_sessions
    SET
      handshake_started_at = v_now,
      state = 'handshake'::public.video_date_state,
      phase = 'handshake',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
    RETURNING * INTO v_row;

    IF FOUND THEN
      v_started_handshake := true;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_started_after_stable_daily_alive',
        NULL,
        v_row.event_id,
        v_uid,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_daily_alive',
          'stable_copresence', v_stable,
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'stable_copresence_required', true
        )
      );
    ELSE
      SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
    END IF;
  END IF;

  v_status := CASE
    WHEN v_row.date_started_at IS NOT NULL
      OR v_row.state = 'date'::public.video_date_state
      OR v_row.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
      ELSE v_row.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_row.event_id
    AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id);

  RETURN jsonb_build_object(
    'ok', true,
    'queue_status', v_status,
    'handshake_started', v_started_handshake,
    'handshake_started_at', v_row.handshake_started_at,
    'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
    'stable_copresence', v_stable,
    'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
    'latest_joined_at', CASE
      WHEN v_uid = v_row.participant_1_id THEN v_row.participant_1_joined_at
      ELSE v_row.participant_2_joined_at
    END,
    'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
    'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
    'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
    'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
    'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
    'owner_state', NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''),
    'reconnect_grace_cleared', v_reconnect_grace_cleared,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_1_active', v_participant_1_active,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'stable_copresence_required', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_alive_stamp_failed',
      'code', 'DAILY_ALIVE_STAMP_FAILED',
      'error_code', 'DAILY_ALIVE_STAMP_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(
  uuid, text, text, text, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Client owner heartbeat for Video Date Daily copresence. Supports stable copresence gating and returns typed JSON for expected lifecycle races.';

NOTIFY pgrst, 'reload schema';

COMMIT;
