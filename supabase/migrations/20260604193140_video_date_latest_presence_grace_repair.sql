BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_latest_presence_is_active(
  p_joined_at timestamptz,
  p_away_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p_joined_at IS NOT NULL
     AND (p_away_at IS NULL OR p_away_at < p_joined_at);
$function$;

COMMENT ON FUNCTION public.video_date_latest_presence_is_active(timestamptz, timestamptz) IS
  'Video Date helper: a participant is active when their latest joined timestamp is newer than their latest away timestamp.';

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

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_participant_1_active
     AND v_participant_2_active THEN
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
        'handshake_started_after_active_daily_copresence',
        NULL,
        v_row.event_id,
        v_uid,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_daily_joined',
          'handshake_started_at', v_row.handshake_started_at,
          'participant_1_joined_at', v_row.participant_1_joined_at,
          'participant_1_away_at', v_row.participant_1_away_at,
          'participant_2_joined_at', v_row.participant_2_joined_at,
          'participant_2_away_at', v_row.participant_2_away_at,
          'active_presence_required', true
        )
      );
    ELSE
      SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
    END IF;
  ELSIF v_row.date_started_at IS NULL
        AND v_row.handshake_started_at IS NULL
        AND v_row.participant_1_joined_at IS NOT NULL
        AND v_row.participant_2_joined_at IS NOT NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'daily_join_waiting_for_active_partner',
      NULL,
      v_row.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_video_date_daily_joined',
        'participant_1_joined_at', v_row.participant_1_joined_at,
        'participant_1_away_at', v_row.participant_1_away_at,
        'participant_1_active', v_participant_1_active,
        'participant_2_joined_at', v_row.participant_2_joined_at,
        'participant_2_away_at', v_row.participant_2_away_at,
        'participant_2_active', v_participant_2_active,
        'active_presence_required', true
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
    'latest_joined_at', v_latest_joined_at,
    'reconnect_grace_cleared', v_reconnect_grace_cleared,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_1_active', v_participant_1_active,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'active_presence_required', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid) IS
  'Private base for mark_video_date_daily_joined fail-soft wrapper. Writes latest Daily joined_at, clears own away state, clears reconnect grace on return, and starts handshake only when both latest presences are active.';

DROP FUNCTION IF EXISTS public.record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
);

ALTER FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) RENAME TO record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_daily_webhook_event_v2(
  p_provider_event_id text,
  p_event_type text,
  p_room_name text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base jsonb;
  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');
  v_provider_user_id text := NULLIF(left(btrim(COALESCE(p_provider_user_id, '')), 180), '');
  v_event_kind text := replace(replace(lower(btrim(COALESCE(p_event_type, ''))), '_', '.'), '-', '.');
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_actor uuid;
  v_actor_role text;
  v_rows_changed integer := 0;
  v_reconnect_grace_cleared boolean := false;
  v_join_proves_return boolean := false;
BEGIN
  v_base := public.record_video_date_daily_webhook_event_v2_20260604193140_latest_presence_base(
    p_provider_event_id,
    p_event_type,
    p_room_name,
    p_provider_participant_id,
    p_provider_user_id,
    p_occurred_at,
    p_payload,
    p_signature_timestamp
  );

  IF COALESCE(v_base->>'state', '') <> 'processed'
     OR v_room_name IS NULL
     OR v_provider_user_id IS NULL
     OR v_event_kind NOT IN ('participant.joined', 'participant.join', 'participant.left', 'participant.leave') THEN
    RETURN v_base;
  END IF;

  IF v_provider_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_provider_user_id::uuid;
  END IF;

  SELECT vs.*
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.daily_room_name = v_room_name
  ORDER BY vs.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_actor IS NULL OR v_session.ended_at IS NOT NULL THEN
    RETURN v_base;
  END IF;

  IF v_actor = v_session.participant_1_id THEN
    v_actor_role := 'participant_1';
  ELSIF v_actor = v_session.participant_2_id THEN
    v_actor_role := 'participant_2';
  ELSE
    RETURN v_base;
  END IF;

  IF v_event_kind IN ('participant.joined', 'participant.join') THEN
    IF v_actor_role = 'participant_1' THEN
      v_join_proves_return := v_session.participant_1_away_at IS NULL OR v_session.participant_1_away_at <= v_occurred_at;
      v_reconnect_grace_cleared := v_join_proves_return AND v_session.reconnect_grace_ends_at IS NOT NULL;
      UPDATE public.video_sessions
      SET
        participant_1_joined_at = GREATEST(COALESCE(participant_1_joined_at, v_occurred_at), v_occurred_at),
        participant_1_away_at = CASE WHEN v_join_proves_return THEN NULL ELSE participant_1_away_at END,
        reconnect_grace_ends_at = CASE WHEN v_join_proves_return THEN NULL ELSE reconnect_grace_ends_at END,
        state_updated_at = v_now
      WHERE id = v_session.id;
    ELSE
      v_join_proves_return := v_session.participant_2_away_at IS NULL OR v_session.participant_2_away_at <= v_occurred_at;
      v_reconnect_grace_cleared := v_join_proves_return AND v_session.reconnect_grace_ends_at IS NOT NULL;
      UPDATE public.video_sessions
      SET
        participant_2_joined_at = GREATEST(COALESCE(participant_2_joined_at, v_occurred_at), v_occurred_at),
        participant_2_away_at = CASE WHEN v_join_proves_return THEN NULL ELSE participant_2_away_at END,
        reconnect_grace_ends_at = CASE WHEN v_join_proves_return THEN NULL ELSE reconnect_grace_ends_at END,
        state_updated_at = v_now
      WHERE id = v_session.id;
    END IF;
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
  ELSE
    IF v_actor_role = 'participant_1' THEN
      UPDATE public.video_sessions
      SET
        participant_1_away_at = v_occurred_at,
        state_updated_at = v_now
      WHERE id = v_session.id
        AND (participant_1_joined_at IS NULL OR v_occurred_at >= participant_1_joined_at)
        AND participant_1_away_at IS DISTINCT FROM v_occurred_at;
    ELSE
      UPDATE public.video_sessions
      SET
        participant_2_away_at = v_occurred_at,
        state_updated_at = v_now
      WHERE id = v_session.id
        AND (participant_2_joined_at IS NULL OR v_occurred_at >= participant_2_joined_at)
        AND participant_2_away_at IS DISTINCT FROM v_occurred_at;
    END IF;
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
  END IF;

  IF v_rows_changed > 0 THEN
    PERFORM public.bump_video_session_seq(v_session.id);
  END IF;

  IF v_reconnect_grace_cleared THEN
    PERFORM public.record_event_loop_observability(
      'daily_webhook_reconciler',
      'success',
      'reconnect_grace_cleared_by_provider_join',
      NULL,
      v_session.event_id,
      v_actor,
      v_session.id,
      jsonb_build_object(
        'event_type', p_event_type,
        'room_name', v_room_name,
        'provider_user_id', v_provider_user_id,
        'actor_role', v_actor_role,
        'latest_joined_at', v_occurred_at,
        'reconnect_grace_cleared', true
      )
    );
  END IF;

  RETURN v_base || jsonb_build_object(
    'latestPresenceRepaired', v_rows_changed > 0,
    'latest_joined_at', CASE WHEN v_event_kind IN ('participant.joined', 'participant.join') THEN v_occurred_at ELSE NULL END,
    'reconnect_grace_cleared', v_reconnect_grace_cleared
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) IS
  'Daily webhook wrapper. Preserves the audited base behavior, then repairs Video Date presence as latest-state: joins advance joined_at and clear grace, stale leaves cannot override newer joins.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260604193140_latest_presence_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260604193140_latest_presence_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260604193140_latest_presence_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260604193140_latest_presence_base(uuid, text, text)
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
  v_session public.video_sessions%ROWTYPE;
  v_actor_active boolean := false;
  v_result jsonb;
  v_rows_changed integer := 0;
BEGIN
  IF v_action = 'mark_reconnect_self_away'
     AND v_reason IN ('web_visibilitychange', 'web_freeze', 'app_background') THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      v_actor_active := CASE
        WHEN v_actor = v_session.participant_1_id THEN
          public.video_date_latest_presence_is_active(v_session.participant_1_joined_at, v_session.participant_1_away_at)
        ELSE
          public.video_date_latest_presence_is_active(v_session.participant_2_joined_at, v_session.participant_2_away_at)
      END;

      IF v_actor_active THEN
        IF v_actor = v_session.participant_1_id THEN
          UPDATE public.video_sessions
          SET
            participant_1_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
        ELSE
          UPDATE public.video_sessions
          SET
            participant_2_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
        END IF;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        IF v_rows_changed > 0 THEN
          PERFORM public.bump_video_session_seq(p_session_id);
        END IF;

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          'mark_reconnect_self_away_suppressed_active_daily_presence',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', v_action,
            'p_reason', v_reason,
            'away_mark_suppressed', true,
            'reconnect_grace_cleared', v_rows_changed > 0,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_1_away_at', v_session.participant_1_away_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'participant_2_away_at', v_session.participant_2_away_at
          )
        );

        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'state', v_session.state,
          'phase', v_session.phase,
          'ended', false,
          'self_marked_away', false,
          'away_mark_suppressed', true,
          'suppression_reason', 'active_daily_presence',
          'reconnect_grace_cleared', v_rows_changed > 0,
          'p_reason', v_reason
        );
      END IF;
    END IF;
  END IF;

  v_result := public.video_date_transition_20260604193140_latest_presence_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF v_action = 'mark_reconnect_return'
     AND COALESCE((v_result->>'ok')::boolean, true) THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      IF v_actor = v_session.participant_1_id THEN
        UPDATE public.video_sessions
        SET
          participant_1_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
      ELSE
        UPDATE public.video_sessions
        SET
          participant_2_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
      END IF;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      IF v_rows_changed > 0 THEN
        PERFORM public.bump_video_session_seq(p_session_id);
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          'reconnect_grace_cleared_by_return',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', v_action,
            'p_reason', v_reason,
            'reconnect_grace_cleared', true
          )
        );
      END IF;
      v_result := v_result || jsonb_build_object('reconnect_grace_cleared', v_rows_changed > 0);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date transition wrapper. Preserves warm-up partner-away suppression, downgrades soft lifecycle self-away while Daily presence is active, and clears reconnect grace on confirmed return.';

CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  r public.video_sessions%ROWTYPE;
  n int := 0;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_should_open_survey boolean := false;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_latest_away_at timestamptz;
  v_remote_seen_after_away boolean := false;
BEGIN
  FOR r IN
    SELECT *
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_participant_1_active := public.video_date_latest_presence_is_active(
      r.participant_1_joined_at,
      r.participant_1_away_at
    );
    v_participant_2_active := public.video_date_latest_presence_is_active(
      r.participant_2_joined_at,
      r.participant_2_away_at
    );
    v_latest_away_at := GREATEST(
      COALESCE(r.participant_1_away_at, '-infinity'::timestamptz),
      COALESCE(r.participant_2_away_at, '-infinity'::timestamptz)
    );
    v_remote_seen_after_away :=
      r.participant_1_remote_seen_at IS NOT NULL
      AND r.participant_2_remote_seen_at IS NOT NULL
      AND v_latest_away_at <> '-infinity'::timestamptz
      AND GREATEST(r.participant_1_remote_seen_at, r.participant_2_remote_seen_at) > v_latest_away_at;

    IF (v_participant_1_active AND v_participant_2_active) OR v_remote_seen_after_away THEN
      UPDATE public.video_sessions
      SET
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = CASE
          WHEN v_participant_1_active OR v_remote_seen_after_away THEN NULL
          ELSE participant_1_away_at
        END,
        participant_2_away_at = CASE
          WHEN v_participant_2_active OR v_remote_seen_after_away THEN NULL
          ELSE participant_2_away_at
        END,
        state_updated_at = v_now
      WHERE id = r.id;

      PERFORM public.bump_video_session_seq(r.id);
      PERFORM public.record_event_loop_observability(
        'expire_video_date_reconnect_graces',
        'no_op',
        'reconnect_grace_expiry_suppressed_latest_presence',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'participant_1_active', v_participant_1_active,
          'participant_2_active', v_participant_2_active,
          'remote_seen_after_away', v_remote_seen_after_away,
          'participant_1_joined_at', r.participant_1_joined_at,
          'participant_2_joined_at', r.participant_2_joined_at,
          'participant_1_away_at', r.participant_1_away_at,
          'participant_2_away_at', r.participant_2_away_at,
          'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', r.participant_2_remote_seen_at
        )
      );
      CONTINUE;
    END IF;

    v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
      v_now,
      'reconnect_grace_expired',
      r.date_started_at,
      r.state::text,
      r.phase,
      r.participant_1_joined_at,
      r.participant_2_joined_at,
      r.participant_1_remote_seen_at,
      r.participant_2_remote_seen_at
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.events ev
      WHERE ev.id = r.event_id
        AND ev.status = 'live'
        AND ev.archived_at IS NULL
    ) INTO v_event_live;

    v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

    UPDATE public.video_sessions
    SET
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        r.duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
      current_room_id = CASE WHEN v_should_open_survey THEN r.id ELSE NULL END,
      current_partner_id = CASE
        WHEN v_should_open_survey AND profile_id = r.participant_1_id THEN r.participant_2_id
        WHEN v_should_open_survey AND profile_id = r.participant_2_id THEN r.participant_1_id
        ELSE NULL
      END,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id);

    PERFORM public.record_event_loop_observability(
      'expire_video_date_reconnect_graces',
      'success',
      CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'ended_reason', 'reconnect_grace_expired',
        'survey_required', v_should_open_survey,
        'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
        'participant_1_joined_at', r.participant_1_joined_at,
        'participant_2_joined_at', r.participant_2_joined_at,
        'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', r.participant_2_remote_seen_at
      )
    );

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.expire_video_date_reconnect_graces() IS
  'Ends expired Video Date reconnect graces only after rechecking latest presence; a newer Daily join or remote-seen-after-away proof suppresses terminalization and clears grace.';

DROP INDEX IF EXISTS public.event_loop_obs_video_date_client_stuck_once_idx;
CREATE UNIQUE INDEX event_loop_obs_video_date_client_stuck_once_idx
  ON public.event_loop_observability_events (session_id, actor_id, operation, reason_code)
  WHERE operation = 'video_date_client_stuck_state'
    AND reason_code NOT IN (
      'daily_call_cleanup',
      'daily_call_reuse',
      'daily_call_busy_internal_retry',
      'remote_seen_canonical_repair_failed'
    );

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
  v_append_only boolean := false;
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
    'daily_call_cleanup',
    'daily_call_reuse',
    'daily_call_busy_internal_retry',
    'remote_seen_canonical_repair_failed',
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

  v_append_only := v_event_name IN (
    'daily_call_cleanup',
    'daily_call_reuse',
    'daily_call_busy_internal_retry',
    'remote_seen_canonical_repair_failed'
  );

  v_outcome := CASE
    WHEN v_event_name IN (
      'prepare_date_entry_failed',
      'daily_join_confirmation_failed',
      'native_background_recovery_failed',
      'remote_seen_canonical_repair_failed'
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
    'room_name', public.video_date_client_stuck_safe_text(v_payload->>'room_name', 180),
    'caller', public.video_date_client_stuck_safe_text(v_payload->>'caller'),
    'meeting_state', public.video_date_client_stuck_safe_text(v_payload->>'meeting_state'),
    'cleanup_reason', public.video_date_client_stuck_safe_text(v_payload->>'cleanup_reason'),
    'latency_bucket', public.video_date_client_stuck_safe_text(v_payload->>'latency_bucket'),
    'entry_attempt_id', public.video_date_client_stuck_safe_text(v_payload->>'entry_attempt_id'),
    'daily_start_attempt_id', public.video_date_client_stuck_safe_text(v_payload->>'daily_start_attempt_id'),
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
    'leave_called', public.video_date_client_stuck_safe_bool(v_payload->>'leave_called'),
    'destroy_called', public.video_date_client_stuck_safe_bool(v_payload->>'destroy_called'),
    'reused', public.video_date_client_stuck_safe_bool(v_payload->>'reused'),
    'observed_at', now()
  ));

  IF v_append_only THEN
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
    );
  ELSE
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
        AND reason_code NOT IN (
          'daily_call_cleanup',
          'daily_call_reuse',
          'daily_call_busy_internal_retry',
          'remote_seen_canonical_repair_failed'
        )
      DO NOTHING;
  END IF;

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
  'Authenticated participant-only sparse client stuck-state audit ingestion for Video Date. Cleanup/reuse/remote-seen repair diagnostics are append-only; older stuck states remain deduped per session/user/event.';

NOTIFY pgrst, 'reload schema';

COMMIT;
