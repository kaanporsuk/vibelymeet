BEGIN;

-- Provider-authoritative presence repair for the 2026-06-06 two-user failure.
-- Client owner heartbeats remain useful telemetry, but they must not revive a
-- participant after Daily has emitted participant.left unless the client is
-- backed by a current provider session.

CREATE OR REPLACE FUNCTION public.video_date_actor_provider_presence_v1(
  p_session_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_latest_client_alive_at timestamptz;
  v_latest_client_provider_session_id text;
  v_latest_client_owner_state text;
  v_left_after_client_alive boolean := false;
  v_provider_webhook_active boolean := false;
  v_client_provider_active boolean := false;
  v_active boolean := false;
  v_active_since_at timestamptz;
  v_source text := 'missing_provider_presence';
BEGIN
  SELECT
    vde.event_type,
    vde.occurred_at,
    NULLIF(vde.payload->'payload'->>'session_id', '')
  INTO
    v_latest_provider_event_type,
    v_latest_provider_event_at,
    v_latest_provider_session_id
  FROM public.video_date_daily_webhook_events vde
  WHERE vde.session_id = p_session_id
    AND vde.provider_user_id = p_actor_id::text
    AND vde.event_type IN ('participant.joined', 'participant.left')
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  SELECT
    vpe.occurred_at,
    vpe.provider_session_id,
    vpe.owner_state
  INTO
    v_latest_client_alive_at,
    v_latest_client_provider_session_id,
    v_latest_client_owner_state
  FROM public.video_date_presence_events vpe
  WHERE vpe.session_id = p_session_id
    AND vpe.actor_id = p_actor_id
    AND vpe.event_type = 'client_daily_alive'
    AND vpe.provider_session_id IS NOT NULL
    AND vpe.owner_state = 'joined'
  ORDER BY vpe.occurred_at DESC
  LIMIT 1;

  IF v_latest_client_provider_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_date_daily_webhook_events vde
      WHERE vde.session_id = p_session_id
        AND vde.provider_user_id = p_actor_id::text
        AND vde.event_type = 'participant.left'
        AND NULLIF(vde.payload->'payload'->>'session_id', '') =
          v_latest_client_provider_session_id
        AND vde.occurred_at >= COALESCE(v_latest_client_alive_at, '-infinity'::timestamptz)
    )
    INTO v_left_after_client_alive;
  END IF;

  v_provider_webhook_active :=
    v_latest_provider_event_type = 'participant.joined'
    AND v_latest_provider_session_id IS NOT NULL;

  v_client_provider_active :=
    v_latest_client_alive_at IS NOT NULL
    AND v_latest_client_provider_session_id IS NOT NULL
    AND v_latest_client_owner_state = 'joined'
    AND v_latest_client_alive_at >= v_now - interval '15 seconds'
    AND NOT v_left_after_client_alive
    AND (
      v_latest_provider_event_at IS NULL
      OR (
        v_latest_provider_event_type = 'participant.joined'
        AND v_latest_provider_session_id = v_latest_client_provider_session_id
      )
      OR (
        v_latest_provider_event_type = 'participant.left'
        AND v_latest_provider_session_id IS NOT NULL
        AND v_latest_provider_session_id IS DISTINCT FROM
          v_latest_client_provider_session_id
        AND v_latest_provider_event_at <= v_latest_client_alive_at
      )
    );

  v_active := v_provider_webhook_active OR v_client_provider_active;

  IF v_provider_webhook_active THEN
    v_active_since_at := v_latest_provider_event_at;
    v_source := 'daily_webhook_joined';
  ELSIF v_client_provider_active THEN
    v_active_since_at := v_latest_client_alive_at;
    v_source := 'provider_backed_client_alive';
  ELSIF v_latest_provider_event_type = 'participant.left' THEN
    v_source := 'daily_webhook_left';
  ELSIF v_latest_client_alive_at IS NOT NULL THEN
    v_source := CASE
      WHEN v_left_after_client_alive THEN 'provider_left_after_client_alive'
      WHEN v_latest_client_alive_at < v_now - interval '15 seconds' THEN 'provider_backed_client_alive_stale'
      ELSE 'provider_backed_client_alive_not_current'
    END;
  END IF;

  RETURN jsonb_build_object(
    'active', v_active,
    'active_since_at', v_active_since_at,
    'source', v_source,
    'latest_provider_event_type', v_latest_provider_event_type,
    'latest_provider_event_at', v_latest_provider_event_at,
    'latest_provider_session_id', v_latest_provider_session_id,
    'latest_client_alive_at', v_latest_client_alive_at,
    'latest_client_provider_session_id', v_latest_client_provider_session_id,
    'latest_client_owner_state', v_latest_client_owner_state,
    'left_after_client_alive', v_left_after_client_alive
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid) IS
  'Returns current provider-backed Daily presence for one Video Date participant. Daily webhook joined state wins; recent provider-session client alive can bridge webhook lag, but never after a matching provider left event.';

CREATE OR REPLACE FUNCTION public.video_date_stable_copresence_v1(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_p1_provider jsonb := '{}'::jsonb;
  v_p2_provider jsonb := '{}'::jsonb;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_participant_1_active_since_at timestamptz;
  v_participant_2_active_since_at timestamptz;
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

  v_p1_provider := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_row.participant_1_id
  );
  v_p2_provider := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_row.participant_2_id
  );

  v_participant_1_active := COALESCE((v_p1_provider->>'active')::boolean, false);
  v_participant_2_active := COALESCE((v_p2_provider->>'active')::boolean, false);
  v_participant_1_active_since_at := NULLIF(v_p1_provider->>'active_since_at', '')::timestamptz;
  v_participant_2_active_since_at := NULLIF(v_p2_provider->>'active_since_at', '')::timestamptz;

  IF v_participant_1_active_since_at IS NOT NULL
     AND v_participant_2_active_since_at IS NOT NULL THEN
    v_latest_joined_at := GREATEST(
      v_participant_1_active_since_at,
      v_participant_2_active_since_at
    );
  END IF;

  IF v_latest_joined_at IS NOT NULL THEN
    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_1_first_heartbeat_at, v_participant_1_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_1_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_latest_joined_at
      AND (
        vpe.event_type = 'owner_heartbeat'
        OR (
          vpe.provider_session_id IS NOT NULL
          AND vpe.owner_state = 'joined'
        )
      );

    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_2_first_heartbeat_at, v_participant_2_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_2_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_latest_joined_at
      AND (
        vpe.event_type = 'owner_heartbeat'
        OR (
          vpe.provider_session_id IS NOT NULL
          AND vpe.owner_state = 'joined'
        )
      );
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
    v_participant_1_active
    AND v_participant_2_active
    AND v_row.participant_1_remote_seen_at IS NOT NULL
    AND v_row.participant_2_remote_seen_at IS NOT NULL
    AND (
      v_participant_1_active_since_at IS NULL
      OR v_row.participant_1_remote_seen_at >= v_participant_1_active_since_at - interval '5 seconds'
    )
    AND (
      v_participant_2_active_since_at IS NULL
      OR v_row.participant_2_remote_seen_at >= v_participant_2_active_since_at - interval '5 seconds'
    );

  IF NOT v_participant_1_active OR NOT v_participant_2_active THEN
    v_reason := CASE
      WHEN v_row.date_started_at IS NOT NULL
        OR v_row.state = 'date'::public.video_date_state
        OR v_row.phase = 'date'
        THEN 'already_date_provider_missing'
      ELSE 'provider_presence_missing'
    END;
  ELSIF v_row.date_started_at IS NOT NULL
        OR v_row.state = 'date'::public.video_date_state
        OR v_row.phase = 'date' THEN
    v_stable := true;
    v_reason := 'already_date_provider_current';
  ELSIF v_remote_seen THEN
    v_stable := true;
    v_reason := 'remote_seen_provider_current';
  ELSIF v_latest_joined_at IS NULL THEN
    v_reason := 'missing_provider_joined_evidence';
  ELSIF v_participant_1_heartbeat_at IS NULL
        OR v_participant_2_heartbeat_at IS NULL THEN
    v_reason := 'missing_owner_heartbeat_after_latest_join';
  ELSIF v_participant_1_heartbeat_at < v_now - interval '15 seconds'
        OR v_participant_2_heartbeat_at < v_now - interval '15 seconds' THEN
    v_reason := 'owner_heartbeat_stale';
  ELSIF v_copresence_since_at <= v_now - interval '2 seconds' THEN
    v_stable := true;
    v_reason := 'stable_provider_owner_heartbeat';
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
    'participant_1_active_since_at', v_participant_1_active_since_at,
    'participant_1_provider_presence', v_p1_provider,
    'participant_1_first_owner_heartbeat_at', v_participant_1_first_heartbeat_at,
    'participant_1_owner_heartbeat_at', v_participant_1_heartbeat_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'participant_2_active_since_at', v_participant_2_active_since_at,
    'participant_2_provider_presence', v_p2_provider,
    'participant_2_first_owner_heartbeat_at', v_participant_2_first_heartbeat_at,
    'participant_2_owner_heartbeat_at', v_participant_2_heartbeat_at,
    'remote_seen', v_remote_seen,
    'provider_presence_required', true
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
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_started_handshake boolean := false;
  v_routeable boolean := false;
  v_actor_had_away boolean := false;
  v_join_stamp_accepted boolean := false;
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
    v_actor_had_away := v_row.participant_1_away_at IS NOT NULL;
    IF NOT v_actor_had_away THEN
      UPDATE public.video_sessions
      SET
        participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
      v_join_stamp_accepted := true;
    END IF;
  ELSE
    v_actor_had_away := v_row.participant_2_away_at IS NOT NULL;
    IF NOT v_actor_had_away THEN
      UPDATE public.video_sessions
      SET
        participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
      v_join_stamp_accepted := true;
    END IF;
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
    CASE WHEN v_actor_had_away THEN 'provider_presence_required' ELSE 'joined' END,
    v_now,
    jsonb_build_object(
      'rpc', 'mark_video_date_daily_joined',
      'join_stamp_accepted', v_join_stamp_accepted,
      'provider_presence_required', v_actor_had_away
    )
  );

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

  v_latest_joined_at := CASE
    WHEN v_uid = v_row.participant_1_id THEN v_row.participant_1_joined_at
    ELSE v_row.participant_2_joined_at
  END;

  IF v_reconnect_grace_cleared AND v_join_stamp_accepted THEN
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
  ELSIF v_actor_had_away THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'daily_join_waiting_for_provider_presence',
      NULL,
      v_row.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_video_date_daily_joined',
        'join_stamp_accepted', false,
        'provider_presence_required', true,
        'participant_1_joined_at', v_row.participant_1_joined_at,
        'participant_2_joined_at', v_row.participant_2_joined_at,
        'participant_1_away_at', v_row.participant_1_away_at,
        'participant_2_away_at', v_row.participant_2_away_at
      )
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
  v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
  v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_stable_copresence THEN
    UPDATE public.video_sessions
    SET
      handshake_started_at = v_now,
      state = 'handshake'::public.video_date_state,
      phase = 'handshake',
      reconnect_grace_ends_at = NULL,
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
          'provider_presence_required', true,
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
        'provider_presence_required', true,
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
    'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
    'join_stamp_accepted', v_join_stamp_accepted,
    'provider_presence_required', true,
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
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_provider_presence jsonb := '{}'::jsonb;
  v_join_stamp_accepted boolean := false;
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

  SELECT
    vde.event_type,
    vde.occurred_at,
    NULLIF(vde.payload->'payload'->>'session_id', '')
  INTO
    v_latest_provider_event_type,
    v_latest_provider_event_at,
    v_latest_provider_session_id
  FROM public.video_date_daily_webhook_events vde
  WHERE vde.session_id = p_session_id
    AND vde.provider_user_id = v_uid::text
    AND vde.event_type IN ('participant.joined', 'participant.left')
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  v_provider_backed_current :=
    v_owner_state = 'joined'
    AND v_provider_session_id IS NOT NULL
    AND (
      v_latest_provider_event_type IS NULL
      OR (
        v_latest_provider_event_type = 'participant.joined'
        AND v_latest_provider_session_id = v_provider_session_id
      )
      OR (
        v_latest_provider_event_type = 'participant.left'
        AND v_latest_provider_session_id IS NOT NULL
        AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
      )
    );

  v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

  IF v_provider_backed_current THEN
    IF v_uid = v_row.participant_1_id THEN
      UPDATE public.video_sessions
      SET
        participant_1_joined_at = GREATEST(COALESCE(participant_1_joined_at, v_now), v_now),
        participant_1_away_at = NULL,
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    ELSE
      UPDATE public.video_sessions
      SET
        participant_2_joined_at = GREATEST(COALESCE(participant_2_joined_at, v_now), v_now),
        participant_2_away_at = NULL,
        reconnect_grace_ends_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id;
    END IF;
    v_join_stamp_accepted := true;
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
    v_provider_session_id,
    NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
    v_owner_state,
    v_now,
    jsonb_build_object(
      'rpc', 'mark_video_date_daily_alive',
      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
      'owner_state', v_owner_state,
      'provider_presence_required', true,
      'provider_backed_current', v_provider_backed_current,
      'join_stamp_accepted', v_join_stamp_accepted,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id
    )
  );

  IF NOT v_provider_backed_current THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'daily_alive_without_current_provider_presence',
      NULL,
      v_row.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_video_date_daily_alive',
        'owner_state', v_owner_state,
        'provider_session_id', v_provider_session_id,
        'provider_presence_required', true,
        'latest_provider_event_type', v_latest_provider_event_type,
        'latest_provider_event_at', v_latest_provider_event_at,
        'latest_provider_session_id', v_latest_provider_session_id
      )
    );
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
  v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
  v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);
  v_provider_presence := CASE
    WHEN v_uid = v_row.participant_1_id THEN v_stable->'participant_1_provider_presence'
    ELSE v_stable->'participant_2_provider_presence'
  END;

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_stable_copresence THEN
    UPDATE public.video_sessions
    SET
      handshake_started_at = v_now,
      state = 'handshake'::public.video_date_state,
      phase = 'handshake',
      reconnect_grace_ends_at = NULL,
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
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'provider_presence_required', true,
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
    'provider_session_id', v_provider_session_id,
    'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
    'owner_state', v_owner_state,
    'provider_presence', v_provider_presence,
    'provider_presence_required', true,
    'provider_backed_current', v_provider_backed_current,
    'join_stamp_accepted', v_join_stamp_accepted,
    'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
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
  'Client owner heartbeat for Video Date Daily copresence. Provider-authoritative: telemetry without current provider-session proof cannot advance joined_at or clear Daily leave state.';

NOTIFY pgrst, 'reload schema';

COMMIT;
