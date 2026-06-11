-- ============================================================================
-- Video Date rebuild PR 5 follow-up: fix a fold bug in
-- public.finalize_video_date_entry_deadline introduced by
-- 20260611215259_video_date_entry_vocab_flip_maintenance_single_bodies.
--
-- The Stage D block (fold of the dropped *_20260603215948_handoff +
-- *_20260603090000 generations) re-declared `v_result`, shadowing the
-- function-level variable, so every terminal-core payload (including
-- SESSION_NOT_FOUND and the deadline terminalization results) was lost and
-- callers only received the promotion-metadata merge. Stage D now uses the
-- function-level v_result; everything else is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_video_date_entry_deadline(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- Stage A: rescue-only early confirmed-encounter promotion (head).
  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    p_actor,
    COALESCE(NULLIF(p_source, ''), 'finalize_video_date_entry_deadline'),
    p_reason,
    false
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  <<base>>
  BEGIN
    -- Stage B (fold of finalize_vd_*_20260605115657): preflight repair,
    -- already-in-date short-circuit, active-confirmed-encounter rescue
    -- promotion, and the v2 launch-evidence deadline extension.
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
    v_previous_entry_started_at timestamptz;
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

      -- (fold) session row missing: fall through to the core stage below

      IF v_session.state::text = 'date'
         OR v_session.phase = 'date'
         OR v_session.date_started_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_session.date_started_at,
          'reason', 'already_in_date',
          'session_seq', COALESCE(v_session.session_seq, 0)
        );
        EXIT base;
      END IF;

      IF v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL THEN
        v_previous_entry_started_at := v_session.entry_started_at;
        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
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
            entry_grace_expires_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            daily_room_name = COALESCE(daily_room_name, v_expected_room_name),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
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
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
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
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
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

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'date',
            'phase', 'date',
            'date_started_at', v_session.date_started_at,
            'reason', 'confirmed_encounter_deadline_rescue',
            'recovered_confirmed_encounter', true,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

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
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = v_now,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
            AND date_started_at IS NULL
          RETURNING * INTO v_session;

          v_seconds_remaining := GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM ((v_now + interval '60 seconds') - clock_timestamp())))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence_v2',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'extension_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'entry',
            'phase', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true,
            'extension_started_at', v_session.entry_started_at,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to launch-evidence v1 stage
    END;

    -- Stage C (fold of finalize_vd_*_20260605085010): both-joined v1
    -- launch-evidence deadline extension.
    DECLARE
    v_now timestamptz := now();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_latest_webhook_join_at timestamptz;
    v_latest_launch_evidence_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_due boolean := false;
    v_seconds_remaining integer;
    BEGIN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        'entry_deadline_preflight'
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL
         AND v_session.participant_1_joined_at IS NOT NULL
         AND v_session.participant_2_joined_at IS NOT NULL THEN

        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_has_explicit_pass := (
          (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
          OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
        );
        v_both_decided := v_session.participant_1_decided_at IS NOT NULL
          AND v_session.participant_2_decided_at IS NOT NULL;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

        v_latest_launch_evidence_at := GREATEST(
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_latest_launch_evidence_at IS NOT NULL
           AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = LEAST(v_now, v_latest_launch_evidence_at),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          v_seconds_remaining := GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((LEAST(v_now, v_latest_launch_evidence_at) + interval '60 seconds') - v_now)))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to the terminal core stage
    END;

    -- Stage D (fold of *_20260603215948_handoff + *_20260603090000): the
    -- terminal deadline core plus the unconfirmed-date guard and v2
    -- survey continuity.
    DECLARE


    v_session public.video_sessions%ROWTYPE;

    v_should_open_survey boolean := false;

    v_event_live boolean := false;

    v_resume_status text := 'idle';
    v_now timestamptz := now();

    v_ev uuid;

    v_p1 uuid;

    v_p2 uuid;

    v_is_p1 boolean := false;

    v_is_p2 boolean := false;

    v_actor_decided_at timestamptz;

    v_partner_decided_at timestamptz;

    v_waiting_for_self boolean := false;

    v_waiting_for_partner boolean := false;

    v_p1_decided boolean := false;

    v_p2_decided boolean := false;

    v_p1_explicit_pass boolean := false;

    v_p2_explicit_pass boolean := false;

    v_due boolean := false;

    v_seconds_remaining integer;

    v_state_before text;

    v_reason_code text;

    v_terminal_reason text;
    BEGIN
      <<term_core>>
      BEGIN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'session_not_found',
            NULL,
            NULL,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
          EXIT term_core;
        END IF;

        v_ev := v_session.event_id;
        v_p1 := v_session.participant_1_id;
        v_p2 := v_session.participant_2_id;
        v_state_before := v_session.state::text;
        v_is_p1 := p_actor IS NOT NULL AND v_p1 = p_actor;
        v_is_p2 := p_actor IS NOT NULL AND v_p2 = p_actor;

        IF p_actor IS NOT NULL AND NOT v_is_p1 AND NOT v_is_p2 THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'access_denied',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'state_before', v_state_before,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
          EXIT term_core;
        END IF;

        v_p1_decided := v_session.participant_1_decided_at IS NOT NULL;
        v_p2_decided := v_session.participant_2_decided_at IS NOT NULL;
        v_p1_explicit_pass := v_p1_decided AND v_session.participant_1_liked IS FALSE;
        v_p2_explicit_pass := v_p2_decided AND v_session.participant_2_liked IS FALSE;
        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;
        v_due := v_session.entry_started_at IS NOT NULL
          AND v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_seconds_remaining := CASE
          WHEN v_session.entry_started_at IS NULL THEN NULL
          ELSE GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((v_session.entry_started_at + interval '60 seconds') - v_now)))::int
          )
        END;

        IF v_session.ended_at IS NOT NULL THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'session_already_ended',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'survey_required', v_should_open_survey,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object(
            'success', true,
            'state', 'ended',
            'already_ended', true,
            'reason', v_session.ended_reason,
            'survey_required', v_should_open_survey,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner
          );
          EXIT term_core;
        END IF;

        IF v_session.state = 'date'::public.video_date_state
           OR v_session.phase = 'date'
           OR v_session.date_started_at IS NOT NULL THEN
          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF v_p1_decided
           AND v_p2_decided
           AND v_session.participant_1_liked IS TRUE
           AND v_session.participant_2_liked IS TRUE THEN
          UPDATE public.video_sessions
          SET
            state = 'date'::public.video_date_state,
            phase = 'date',
            date_started_at = COALESCE(date_started_at, v_now),
            entry_grace_expires_at = NULL,
            reconnect_grace_ends_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          UPDATE public.event_registrations
          SET
            queue_status = 'in_date',
            current_room_id = p_session_id,
            current_partner_id = CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END,
            last_active_at = v_now
          WHERE event_id = v_ev
            AND profile_id IN (v_p1, v_p2);

          SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'entry_deadline_completed_mutual',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', false,
              'waiting_for_partner', false,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF NOT v_due THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_not_due',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'seconds_remaining', v_seconds_remaining,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', false,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'seconds_remaining', v_seconds_remaining
          );
          EXIT term_core;
        END IF;

        IF v_p1_explicit_pass OR v_p2_explicit_pass OR (v_p1_decided AND v_p2_decided) THEN
          v_terminal_reason := 'entry_not_mutual';
          v_reason_code := 'entry_deadline_not_mutual';
        ELSE
          v_terminal_reason := 'entry_timeout';
          v_reason_code := 'entry_deadline_timeout';
        END IF;

        UPDATE public.video_sessions
        SET
          state = 'ended'::public.video_date_state,
          phase = 'ended',
          ended_at = COALESCE(ended_at, v_now),
          ended_reason = v_terminal_reason,
          entry_grace_expires_at = NULL,
          reconnect_grace_ends_at = NULL,
          participant_1_away_at = NULL,
          participant_2_away_at = NULL,
          duration_seconds = COALESCE(
            duration_seconds,
            GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.entry_started_at, v_session.started_at))))::int)
          ),
          state_updated_at = v_now
        WHERE id = p_session_id
          AND ended_at IS NULL;

        SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

        v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
          v_session.ended_at,
          v_session.ended_reason,
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at
        );

        UPDATE public.event_registrations
        SET
          queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'idle' END,
          current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
          current_partner_id = CASE
            WHEN v_should_open_survey THEN CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END
            ELSE NULL
          END,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);

        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          v_reason_code,
          NULL,
          v_ev,
          p_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'complete_entry',
            'source', p_source,
            'participant_1_liked', v_session.participant_1_liked,
            'participant_2_liked', v_session.participant_2_liked,
            'participant_1_decided_at', v_session.participant_1_decided_at,
            'participant_2_decided_at', v_session.participant_2_decided_at,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'state_before', v_state_before,
            'state_after', v_session.state::text,
            'deadline_due', true,
            'entry_deadline_seconds', 60,
            'entry_grace_removed', true,
            'survey_required', v_should_open_survey,
            'entry_grace_expires_at', v_session.entry_grace_expires_at,
            'p_reason', p_reason
          )
        );

        v_result := jsonb_build_object(
          'success', true,
          'state', 'ended',
          'reason', v_terminal_reason,
          'survey_required', v_should_open_survey,
          'waiting_for_self', v_waiting_for_self,
          'waiting_for_partner', v_waiting_for_partner,
          'local_decision_persisted', NOT v_waiting_for_self,
          'partner_decision_persisted', NOT v_waiting_for_partner
        );
        EXIT term_core;  END;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'date' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND NOT public.video_date_session_has_confirmed_encounter(
             v_session.date_started_at,
             v_session.state::text,
             v_session.phase,
             v_session.participant_1_joined_at,
             v_session.participant_2_joined_at,
             v_session.participant_1_remote_seen_at,
             v_session.participant_2_remote_seen_at
           ) THEN
          v_result := public.end_unconfirmed_video_date_start(
            p_session_id,
            p_actor,
            'deadline_' || COALESCE(NULLIF(p_source, ''), 'unknown'),
            p_reason
          );
          EXIT base;
        END IF;
      END IF;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'ended' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at,
            v_session.participant_1_remote_seen_at,
            v_session.participant_2_remote_seen_at
          );

          IF v_should_open_survey THEN
            UPDATE public.event_registrations
            SET
              queue_status = 'in_survey',
              current_room_id = p_session_id,
              current_partner_id = CASE
                WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
                ELSE v_session.participant_1_id
              END,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);
          ELSE
            SELECT EXISTS (
              SELECT 1
              FROM public.events ev
              WHERE ev.id = v_session.event_id
                AND ev.status = 'live'
                AND ev.archived_at IS NULL
            ) INTO v_event_live;
            v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

            UPDATE public.event_registrations
            SET
              queue_status = v_resume_status,
              current_room_id = NULL,
              current_partner_id = NULL,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
              AND (current_room_id = p_session_id OR current_room_id IS NULL);
          END IF;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            CASE WHEN v_should_open_survey THEN 'deadline_confirmed_encounter_survey' ELSE 'deadline_unconfirmed_encounter_no_survey' END,
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'source', p_source,
              'reason', p_reason,
              'ended_reason', v_session.ended_reason,
              'date_started_at', v_session.date_started_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'survey_required', v_should_open_survey,
              'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END
            )
          );
        END IF;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey);
        EXIT base;
      END IF;

      v_result := v_result;
      EXIT base;    END;
  END;

  -- Head tail: post-base canonical room repair + promotion metadata merge.
  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'finalize_video_date_entry_deadline:post_base_room_repair'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;
