-- Video Date confirmed-encounter deadline rescue.
--
-- Production session 26d56372-7505-49ac-b701-c3e7be5c806c proved that
-- Ready Gate, same Daily room, provider joins, and bilateral remote media can
-- all succeed while paired handshake auto-promote calls still race into a
-- zero-second launch-evidence extension followed by handshake_timeout.
--
-- This wrapper makes confirmed bilateral remote media authoritative before a
-- no-decision timeout, and fixes launch-evidence extension to grant a real
-- positive window from the current transaction time.

BEGIN;

DROP FUNCTION IF EXISTS public.finalize_vd_handshake_deadline_20260605085010_base(
  uuid,
  uuid,
  text,
  text
);

ALTER FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  RENAME TO finalize_vd_handshake_deadline_20260605085010_base;

REVOKE ALL ON FUNCTION public.finalize_vd_handshake_deadline_20260605085010_base(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_vd_handshake_deadline_20260605085010_base(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_latest_webhook_join_at timestamptz;
  v_latest_launch_evidence_at timestamptz;
  v_participant_1_latest_evidence_at timestamptz;
  v_participant_2_latest_evidence_at timestamptz;
  v_first_confirmed_encounter_at timestamptz;
  v_has_explicit_pass boolean := false;
  v_both_decided boolean := false;
  v_due boolean := false;
  v_confirmed_encounter boolean := false;
  v_active_confirmed_encounter boolean := false;
  v_previous_handshake_started_at timestamptz;
  v_date_started_at timestamptz;
  v_seconds_remaining integer;
  v_event jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'confirmed_encounter_deadline_preflight'
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.finalize_vd_handshake_deadline_20260605085010_base(
      p_session_id,
      p_actor,
      p_source,
      p_reason
    );
  END IF;

  IF v_session.state::text = 'date'
     OR v_session.phase = 'date'
     OR v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'already_in_date',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.ended_at IS NULL
     AND v_session.state = 'handshake'::public.video_date_state
     AND v_session.date_started_at IS NULL
     AND v_session.handshake_started_at IS NOT NULL THEN
    v_previous_handshake_started_at := v_session.handshake_started_at;
    v_due := v_session.handshake_started_at + interval '60 seconds' <= v_now;
    v_has_explicit_pass := (
      (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
      OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
    );
    v_both_decided := v_session.participant_1_decided_at IS NOT NULL
      AND v_session.participant_2_decided_at IS NOT NULL;

    v_participant_1_latest_evidence_at := GREATEST(
      COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz)
    );
    v_participant_2_latest_evidence_at := GREATEST(
      COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
    );

    v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    );
    v_active_confirmed_encounter := v_confirmed_encounter
      AND (
        v_session.participant_1_away_at IS NULL
        OR v_session.participant_1_away_at <= v_participant_1_latest_evidence_at
      )
      AND (
        v_session.participant_2_away_at IS NULL
        OR v_session.participant_2_away_at <= v_participant_2_latest_evidence_at
      );

    v_first_confirmed_encounter_at := GREATEST(
      COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
    );

    IF v_due
       AND NOT v_has_explicit_pass
       AND NOT v_both_decided
       AND v_active_confirmed_encounter THEN
      v_date_started_at := v_now;

      UPDATE public.video_sessions
      SET
        state = 'date'::public.video_date_state,
        phase = 'date',
        date_started_at = v_date_started_at,
        ended_at = NULL,
        ended_reason = NULL,
        reconnect_grace_ends_at = NULL,
        handshake_grace_expires_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        daily_room_name = COALESCE(daily_room_name, v_expected_room_name),
        state_updated_at = v_now
      WHERE id = p_session_id
        AND ended_at IS NULL
        AND state = 'handshake'::public.video_date_state
        AND date_started_at IS NULL
      RETURNING * INTO v_session;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
          ELSE v_session.participant_1_id
        END,
        last_active_at = v_now
      WHERE event_id = v_session.event_id
        AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

      v_event := public.append_video_session_event_v2(
        p_session_id,
        'confirmed_encounter_deadline_promoted_to_date',
        'participants',
        p_actor,
        jsonb_build_object(
          'action', 'complete_handshake',
          'source', p_source,
          'p_reason', p_reason,
          'previous_handshake_started_at', v_previous_handshake_started_at,
          'date_started_at', v_date_started_at,
          'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
        ),
        jsonb_build_object(
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_date_started_at,
          'reason', 'confirmed_encounter_deadline_rescue'
        ),
        true,
        gen_random_uuid()
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'confirmed_encounter_deadline_promoted_to_date',
        NULL,
        v_session.event_id,
        p_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'source', p_source,
          'p_reason', p_reason,
          'previous_handshake_started_at', v_previous_handshake_started_at,
          'date_started_at', v_date_started_at,
          'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'participant_1_away_at', v_session.participant_1_away_at,
          'participant_2_away_at', v_session.participant_2_away_at,
          'event_result', v_event
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'state', 'date',
        'phase', 'date',
        'date_started_at', v_session.date_started_at,
        'reason', 'confirmed_encounter_deadline_rescue',
        'recovered_confirmed_encounter', true,
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    SELECT max(w.occurred_at)
    INTO v_latest_webhook_join_at
    FROM public.video_date_daily_webhook_events w
    WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
      AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
      AND w.occurred_at >= v_session.handshake_started_at;

    v_latest_launch_evidence_at := GREATEST(
      COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
    );

    IF v_due
       AND NOT v_has_explicit_pass
       AND NOT v_both_decided
       AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
       AND v_latest_launch_evidence_at > v_session.handshake_started_at THEN
      UPDATE public.video_sessions
      SET
        handshake_started_at = v_now,
        state_updated_at = v_now
      WHERE id = p_session_id
        AND ended_at IS NULL
        AND state = 'handshake'::public.video_date_state
        AND date_started_at IS NULL
      RETURNING * INTO v_session;

      v_seconds_remaining := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM ((v_now + interval '60 seconds') - clock_timestamp())))::int
      );

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'handshake_deadline_extended_for_launch_evidence_v2',
        NULL,
        v_session.event_id,
        p_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'source', p_source,
          'p_reason', p_reason,
          'previous_handshake_started_at', v_previous_handshake_started_at,
          'extension_started_at', v_session.handshake_started_at,
          'latest_launch_evidence_at', v_latest_launch_evidence_at,
          'latest_webhook_join_at', v_latest_webhook_join_at,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'seconds_remaining', v_seconds_remaining
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'state', 'handshake',
        'phase', 'handshake',
        'reason', 'handshake_launch_evidence_extension',
        'seconds_remaining', v_seconds_remaining,
        'extended', true,
        'extension_started_at', v_session.handshake_started_at,
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;
  END IF;

  RETURN public.finalize_vd_handshake_deadline_20260605085010_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text) IS
  'Handshake deadline finalizer with confirmed-encounter rescue. A no-decision timeout cannot end a session after bilateral remote media unless someone explicitly passed; launch-evidence extensions grant positive time from now.';

COMMIT;
