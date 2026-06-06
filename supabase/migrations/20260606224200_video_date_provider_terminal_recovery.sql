-- Provider-terminal Video Date recovery.
--
-- The 2026-06-06 production run 98d50175-1c75-4966-a6e6-f444c4631289
-- briefly reached a real Daily date, then provider-backed presence collapsed.
-- Clients kept sending hot-path heartbeats and surface claims while terminal
-- survey recovery was contending with PostgREST pool timeouts. This corrective
-- migration keeps the provider-authoritative contract, but makes the heartbeat
-- path bounded and non-mutating once encounter evidence exists.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_video_date_presence_events_alive_recent
  ON public.video_date_presence_events (session_id, actor_id, event_type, occurred_at DESC)
  WHERE event_type = 'client_daily_alive';

CREATE INDEX IF NOT EXISTS idx_event_loop_observability_video_date_noop_recent
  ON public.event_loop_observability_events (session_id, actor_id, reason_code, created_at DESC)
  WHERE operation = 'video_date_transition';

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
  v_presence_event_recorded boolean := false;
  v_noop_observability_recorded boolean := false;
  v_presence_throttle interval;
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

  IF v_uid IS DISTINCT FROM v_row.participant_1_id
     AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'forbidden',
      'retryable', false
    );
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    UPDATE public.video_date_surface_claims
    SET released_at = COALESCE(released_at, v_now),
        updated_at = v_now
    WHERE profile_id = v_uid
      AND session_id = p_session_id
      AND surface = 'video_date'
      AND released_at IS NULL;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'session_ended',
      'retryable', false,
      'terminal', true,
      'queue_status', 'in_survey',
      'ended_at', v_row.ended_at,
      'ended_reason', v_row.ended_reason,
      'surface_claim_released', true
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

  v_presence_throttle := CASE
    WHEN v_provider_backed_current THEN interval '6 seconds'
    ELSE interval '30 seconds'
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_uid
      AND vpe.event_type = 'client_daily_alive'
      AND vpe.provider_session_id IS NOT DISTINCT FROM v_provider_session_id
      AND vpe.owner_state IS NOT DISTINCT FROM v_owner_state
      AND vpe.occurred_at >= v_now - v_presence_throttle
    LIMIT 1
  ) THEN
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
        'join_stamp_accepted', v_provider_backed_current,
        'latest_provider_event_type', v_latest_provider_event_type,
        'latest_provider_event_at', v_latest_provider_event_at,
        'latest_provider_session_id', v_latest_provider_session_id,
        'provider_participant_id_source', 'provider_participant_id_or_payload',
        'throttle_window_seconds', EXTRACT(EPOCH FROM v_presence_throttle)::integer
      )
    );
    v_presence_event_recorded := true;
  END IF;

  IF NOT v_provider_backed_current THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.event_loop_observability_events el
      WHERE el.operation = 'video_date_transition'
        AND el.session_id = p_session_id
        AND el.actor_id = v_uid
        AND el.reason_code = 'daily_alive_without_current_provider_presence'
        AND el.created_at >= v_now - interval '30 seconds'
      LIMIT 1
    ) THEN
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
          'provider_participant_id_source', 'provider_participant_id_or_payload',
          'throttled', true
        )
      );
      v_noop_observability_recorded := true;
    END IF;

    v_status := CASE
      WHEN v_row.date_started_at IS NOT NULL
        OR v_row.state = 'date'::public.video_date_state
        OR v_row.phase = 'date'
        THEN 'in_date'
      ELSE 'in_handshake'
    END;

    RETURN jsonb_build_object(
      'ok', true,
      'queue_status', v_status,
      'handshake_started', false,
      'waiting_for_stable_copresence', true,
      'retry_after_ms', 3000,
      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
      'owner_state', v_owner_state,
      'provider_presence_required', true,
      'provider_backed_current', false,
      'presence_event_recorded', v_presence_event_recorded,
      'noop_observability_recorded', v_noop_observability_recorded,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id,
      'provider_presence_missing', true,
      'provider_presence_terminal', v_latest_provider_event_type = 'participant.left',
      'join_stamp_accepted', false,
      'stable_copresence_required', true
    );
  END IF;

  v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

  IF v_uid = v_row.participant_1_id THEN
    UPDATE public.video_sessions
    SET
      participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
      participant_1_away_at = NULL,
      reconnect_grace_ends_at = NULL,
      state_updated_at = CASE
        WHEN participant_1_joined_at IS NULL
          OR participant_1_away_at IS NOT NULL
          OR reconnect_grace_ends_at IS NOT NULL
        THEN v_now
        ELSE state_updated_at
      END
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET
      participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
      participant_2_away_at = NULL,
      reconnect_grace_ends_at = NULL,
      state_updated_at = CASE
        WHEN participant_2_joined_at IS NULL
          OR participant_2_away_at IS NOT NULL
          OR reconnect_grace_ends_at IS NOT NULL
        THEN v_now
        ELSE state_updated_at
      END
    WHERE id = p_session_id;
  END IF;
  v_join_stamp_accepted := true;

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
    AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
    AND (
      queue_status IS DISTINCT FROM v_status
      OR current_room_id IS DISTINCT FROM p_session_id
      OR current_partner_id IS DISTINCT FROM CASE
        WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
        ELSE v_row.participant_1_id
      END
      OR last_active_at < v_now - interval '15 seconds'
      OR last_active_at IS NULL
    );

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
    'presence_event_recorded', v_presence_event_recorded,
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
  'Client owner heartbeat for Video Date Daily copresence. Provider-authoritative and bounded: no-provider heartbeats are throttled telemetry, accepted joins preserve first join evidence, and terminal sessions release stale video-date surface ownership.';

NOTIFY pgrst, 'reload schema';

COMMIT;
