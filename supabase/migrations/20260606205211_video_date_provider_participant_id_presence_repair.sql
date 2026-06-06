BEGIN;

-- Follow-up to 20260606203000. Daily webhook ingestion stores the provider
-- participant/session identity in video_date_daily_webhook_events.provider_participant_id.
-- Presence checks must prefer that column and only fall back to sanitized payload paths.

CREATE OR REPLACE FUNCTION public.video_date_daily_provider_session_id_from_event_v1(
  p_provider_participant_id text,
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    NULLIF(left(btrim(COALESCE(p_provider_participant_id, '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'participant'->>'id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'participant'->>'session_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'participant'->>'sessionId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->>'participant_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->>'participantId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->'participant'->>'id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->'participant'->>'session_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->'participant'->>'sessionId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->>'participant_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->>'participantId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->>'session_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'payload'->>'sessionId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'data'->'participant'->>'id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'data'->'participant'->>'session_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'data'->'participant'->>'sessionId', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'data'->>'participant_id', '')), 180), ''),
    NULLIF(left(btrim(COALESCE(p_payload->'data'->>'participantId', '')), 180), '')
  );
$function$;

REVOKE ALL ON FUNCTION public.video_date_daily_provider_session_id_from_event_v1(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_daily_provider_session_id_from_event_v1(text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_daily_provider_session_id_from_event_v1(text, jsonb) IS
  'Extracts Daily participant/provider session identity from the recorded webhook column first, then sanitized payload fallback paths.';

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
    public.video_date_daily_provider_session_id_from_event_v1(
      vde.provider_participant_id,
      vde.payload
    )
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
        AND public.video_date_daily_provider_session_id_from_event_v1(
          vde.provider_participant_id,
          vde.payload
        ) = v_latest_client_provider_session_id
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
    'left_after_client_alive', v_left_after_client_alive,
    'provider_session_source', CASE
      WHEN v_latest_provider_session_id IS NOT NULL THEN 'provider_participant_id_or_payload'
      ELSE 'missing'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_actor_provider_presence_v1(uuid, uuid) IS
  'Returns current provider-backed Daily presence for one Video Date participant. Daily webhook joined state uses provider_participant_id first; recent provider-session client alive can bridge webhook lag, but never after a matching provider left event.';

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
    public.video_date_daily_provider_session_id_from_event_v1(
      vde.provider_participant_id,
      vde.payload
    )
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
      'latest_provider_session_id', v_latest_provider_session_id,
      'provider_participant_id_source', 'provider_participant_id_or_payload'
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
        'latest_provider_session_id', v_latest_provider_session_id,
        'provider_participant_id_source', 'provider_participant_id_or_payload'
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
  'Client owner heartbeat for Video Date Daily copresence. Provider-authoritative: telemetry without current provider-session proof cannot advance joined_at or clear Daily leave state; webhook provider_participant_id is the primary provider session source.';

NOTIFY pgrst, 'reload schema';

COMMIT;
