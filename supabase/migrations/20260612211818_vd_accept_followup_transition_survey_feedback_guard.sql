-- VD acceptance-run follow-up (Issue 1a): guard the terminal in_survey re-stamp in
-- public.video_date_transition.
--
-- Defect (live forensics 2026-06-12, acceptance tag vd-accept-20260612-297055): the
-- result-state-'ended' post-processing block re-stamped BOTH event_registrations rows to
-- queue_status='in_survey' + current_room_id on EVERY successful 'ended' result, including
-- fail-soft already_ended revisits of a dead session. With both date_feedback rows already
-- persisted, revisiting partner A re-stamped completed partner B, whose client then entered a
-- lobby <-> /date route ping-pong (observability reason 'terminal_confirmed_encounter_survey').
--
-- Fix: copy mark_video_date_remote_seen's guard semantics. The pair is stamped in_survey only
-- while at least one participant still lacks a date_feedback row for the session; once both
-- rows exist the branch falls through to the existing release semantics (browsing/idle, room
-- cleared, predicate current_room_id = session). A new observability reason
-- 'terminal_survey_already_complete' marks guard activations, and survey_required in the
-- result/detail payloads now reflects the guarded value so feedback-complete clients route to
-- the next surface instead of reopening the survey.
--
-- The first-end stamp inside the deep block is intentionally untouched: it runs only on the
-- actual end transition, where feedback cannot exist yet.
--
-- Full single-body recreate (forward-only); base body dumped from live (project
-- schdyxcunwcvddlcshwd) on 2026-06-12 post-PR-10 and patched only at the six sites above.

CREATE OR REPLACE FUNCTION public.video_date_transition(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_delegate_action text;
  v_norm_action text;
  v_norm_reason text;
  v_now timestamptz := now();
  v_clock_now timestamptz;
  v_session public.video_sessions%ROWTYPE;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner uuid;
  v_is_p1 boolean;
  v_state_before text;
  v_rowcnt integer := 0;
  v_success boolean := false;
  -- prepare_entry
  v_actionability jsonb;
  v_protection jsonb := NULL;
  v_attempt_id text;
  v_already_entry boolean := false;
  v_gate_live boolean := false;
  v_active_lease boolean := false;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_lease_expires_at timestamptz;
  v_previous_lease_expires_at timestamptz;
  v_blocked boolean := false;
  -- reconnect / presence
  v_actor_joined_at timestamptz;
  v_actor_away_at timestamptz;
  v_partner_away_at timestamptz;
  v_actor_remote_seen_at timestamptz;
  v_surface_claim_at timestamptz;
  v_actor_active boolean := false;
  v_surface_active boolean := false;
  v_remote_seen_active boolean := false;
  v_recent_remote_seen boolean := false;
  v_recent_joined boolean := false;
  v_recent_entry boolean := false;
  v_warmup_state boolean := false;
  v_warmup_window interval := interval '20 seconds';
  -- end handling
  v_canonical_reason text;
  v_effective_reason text;
  v_reached_date_phase boolean := false;
  v_exactly_one_joined boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_end_reason text;
  v_joined_participant_id uuid;
  v_missing_participant_id uuid;
  v_joined_slot text;
  -- handshake decisions
  v_decision boolean;
  v_actor_decided_at timestamptz;
  v_partner_decided_at timestamptz;
  v_waiting_for_self boolean;
  v_waiting_for_partner boolean;
  -- pipeline
  v_result jsonb := NULL;
  v_skip_inner_posts boolean := false;
  v_skip_middle boolean := false;
  v_skip_actionability_mark boolean := false;
  v_should_open_survey boolean := false;
  v_survey_feedback_complete boolean := false;
  v_server_now_ms bigint;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- PR-5 vocabulary flip: entry-vocabulary action names are canonical.
  -- Legacy handshake action names remain accepted as aliases.
  v_delegate_action := CASE v_action
    WHEN 'complete_handshake' THEN 'complete_entry'
    WHEN 'continue_handshake' THEN 'continue_entry'
    ELSE p_action
  END;
  v_norm_action := lower(btrim(COALESCE(v_delegate_action, '')));
  v_norm_reason := NULLIF(lower(btrim(COALESCE(p_reason, ''))), '');

  IF v_action = 'enter_handshake' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_date_transition',
      'action', v_action,
      'error', 'standalone_enter_handshake_removed',
      'reason', 'standalone_enter_handshake_removed',
      'message', 'Standalone enter_handshake is removed. Use prepare_entry via prepare_date_entry.',
      'code', 'ENTER_HANDSHAKE_REMOVED',
      'error_code', 'ENTER_HANDSHAKE_REMOVED',
      'retryable', false,
      'terminal', false,
      'removed_public_action', true,
      'supported_action', 'prepare_entry',
      'entry_command', 'prepare_date_entry',
      'prepare_entry_required', true,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  BEGIN
    -- ── Ready Gate actionability precheck (formerly vdt_both_ready_owner) ──
    IF v_norm_action = 'prepare_entry' THEN
      v_actionability := public.video_date_ready_gate_actionability_v1(
        p_session_id,
        v_actor,
        'video_date_transition.prepare_entry',
        false,
        true,
        true,
        true
      );

      IF lower(COALESCE(v_actionability ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
        v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
          p_session_id,
          v_actor,
          'video_date_transition',
          v_actionability
            - 'sqlstate'
            - 'message'
            - 'detail'
            - 'hint'
            - 'context'
            || jsonb_build_object(
              'ok', false,
              'success', false,
              'action', 'prepare_entry',
              'code', COALESCE(v_actionability ->> 'code', v_actionability ->> 'error_code', 'READY_GATE_NOT_ACTIONABLE'),
              'error_code', COALESCE(v_actionability ->> 'error_code', v_actionability ->> 'code', 'READY_GATE_NOT_ACTIONABLE'),
              'error', COALESCE(v_actionability ->> 'error', 'ready_gate_not_actionable'),
              'reason', COALESCE(v_actionability ->> 'reason', 'ready_gate_not_actionable')
            )
        );
        v_skip_inner_posts := true;
        v_skip_middle := true;
        v_skip_actionability_mark := true;
      END IF;
    END IF;

    -- ── Prepare-lease protection precheck (formerly vdt_terminal_lifecycle) ──
    IF v_result IS NULL AND v_delegate_action = 'prepare_entry' THEN
      v_attempt_id := NULLIF(substring(COALESCE(p_reason, '') FROM '^entry_attempt:(.+)$'), '');
      v_protection := public.video_date_protect_both_ready_entry_v1(
        p_session_id,
        v_actor,
        v_attempt_id,
        'video_date_transition_prepare_entry'
      );

      IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) IS FALSE
         AND COALESCE(v_protection ->> 'code', '') IN ('SESSION_NOT_FOUND', 'SESSION_ENDED', 'ACCESS_DENIED', 'EVENT_INACTIVE') THEN
        v_result := v_protection;
        v_skip_inner_posts := true;
      END IF;
    END IF;

    IF v_result IS NULL THEN
      BEGIN
        -- ── Self-away suppression (formerly vdt_single_owner) ──
        IF v_norm_action = 'mark_reconnect_self_away'
           AND v_norm_reason IN (
             'web_visibilitychange',
             'web_freeze',
             'web_beforeunload',
             'web_pagehide',
             'app_background'
           ) THEN
          v_clock_now := clock_timestamp();

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id
          FOR UPDATE;

          IF FOUND
             AND v_actor IS NOT NULL
             AND v_session.ended_at IS NULL
             AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
             AND (
               v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
               OR v_session.phase IN ('entry', 'date')
               OR v_session.entry_started_at IS NOT NULL
               OR v_session.date_started_at IS NOT NULL
             ) THEN
            v_actor_joined_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_joined_at
              ELSE v_session.participant_2_joined_at
            END;
            v_actor_away_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_away_at
              ELSE v_session.participant_2_away_at
            END;
            v_actor_remote_seen_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_remote_seen_at
              ELSE v_session.participant_2_remote_seen_at
            END;
            v_actor_active := public.video_date_latest_presence_is_active(v_actor_joined_at, v_actor_away_at);
            v_remote_seen_active :=
              v_actor_remote_seen_at IS NOT NULL
              AND (v_actor_away_at IS NULL OR v_actor_remote_seen_at >= v_actor_away_at);

            SELECT max(GREATEST(COALESCE(updated_at, claimed_at), claimed_at))
            INTO v_surface_claim_at
            FROM public.video_date_surface_claims
            WHERE session_id = p_session_id
              AND profile_id = v_actor
              AND surface = 'video_date'
              AND released_at IS NULL
              AND expires_at >= v_clock_now - interval '2 seconds';

            v_surface_active := v_surface_claim_at IS NOT NULL;

            IF v_actor_active OR v_remote_seen_active OR v_surface_active THEN
              IF v_actor = v_session.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              END IF;
              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt > 0 THEN
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
                  'action', v_norm_action,
                  'p_reason', v_norm_reason,
                  'away_mark_suppressed', true,
                  'reconnect_grace_cleared', v_rowcnt > 0,
                  'actor_joined_at', v_actor_joined_at,
                  'actor_away_at', v_actor_away_at,
                  'actor_remote_seen_at', v_actor_remote_seen_at,
                  'surface_claim_at', v_surface_claim_at,
                  'active_by_joined_presence', v_actor_active,
                  'active_by_remote_seen', v_remote_seen_active,
                  'active_by_surface_claim', v_surface_active
                )
              );

              v_result := jsonb_build_object(
                'ok', true,
                'success', true,
                'state', v_session.state,
                'phase', v_session.phase,
                'ended', false,
                'self_marked_away', false,
                'away_mark_suppressed', true,
                'suppression_reason', 'active_daily_presence',
                'reconnect_grace_cleared', v_rowcnt > 0,
                'p_reason', v_norm_reason
              );
              v_skip_inner_posts := true;
            END IF;
          END IF;
        END IF;

        -- ── Partner-away suppression (formerly vdt_latest_presence) ──
        IF v_result IS NULL
           AND v_norm_action = 'mark_reconnect_partner_away'
           AND COALESCE(v_norm_reason, '') <> 'daily_transport_grace_expired' THEN
          v_clock_now := clock_timestamp();

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id
          FOR UPDATE;

          IF FOUND
             AND v_actor IS NOT NULL
             AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
             AND v_session.ended_at IS NULL THEN
            v_recent_remote_seen :=
              v_session.participant_1_remote_seen_at IS NOT NULL
              AND v_session.participant_2_remote_seen_at IS NOT NULL
              AND GREATEST(
                v_session.participant_1_remote_seen_at,
                v_session.participant_2_remote_seen_at
              ) >= v_clock_now - v_warmup_window;

            v_recent_joined :=
              v_session.participant_1_joined_at IS NOT NULL
              AND v_session.participant_2_joined_at IS NOT NULL
              AND GREATEST(
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at
              ) >= v_clock_now - v_warmup_window;

            v_recent_entry :=
              v_session.entry_started_at IS NOT NULL
              AND v_session.entry_started_at >= v_clock_now - v_warmup_window;

            v_warmup_state :=
              v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
              OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              OR v_session.entry_started_at IS NOT NULL
              OR v_session.date_started_at IS NOT NULL;

            IF v_warmup_state
               AND (v_recent_remote_seen OR v_recent_joined OR v_recent_entry) THEN
              BEGIN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'mark_reconnect_partner_away_suppressed_transport_grace_pending',
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_norm_action,
                    'p_reason', v_norm_reason,
                    'away_mark_suppressed', true,
                    'daily_transport_grace_required', true,
                    'warmup_window_seconds', extract(epoch from v_warmup_window)::integer,
                    'participant_1_joined_at', v_session.participant_1_joined_at,
                    'participant_2_joined_at', v_session.participant_2_joined_at,
                    'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                    'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                    'entry_started_at', v_session.entry_started_at
                  )
                );
              EXCEPTION
                WHEN OTHERS THEN
                  NULL;
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'success', true,
                'state', v_session.state,
                'phase', v_session.phase,
                'ended', false,
                'partner_marked_away', false,
                'away_mark_suppressed', true,
                'suppression_reason', 'daily_transport_grace_required',
                'daily_transport_grace_required', true,
                'p_reason', v_norm_reason,
                'participant_1_joined_at', v_session.participant_1_joined_at,
                'participant_2_joined_at', v_session.participant_2_joined_at,
                'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                'entry_started_at', v_session.entry_started_at
              );
              v_skip_inner_posts := true;
            END IF;
          END IF;
        END IF;

        -- ── Deep dispatch (the effective legacy machine) ──
        IF v_result IS NULL THEN
          <<deep>>
          LOOP
            -- complete_entry delegates to the deadline finalizer
            -- (formerly vdt_survey_continuity).
            IF v_delegate_action = 'complete_entry' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

              v_result := public.finalize_video_date_entry_deadline(
                p_session_id,
                v_actor,
                'rpc_complete_entry',
                p_reason
              );
              EXIT deep;
            END IF;

            -- Late vibe/pass after the 60s handshake deadline goes to the
            -- finalizer (formerly vdt_survey_continuity).
            IF v_delegate_action IN ('vibe', 'pass') AND v_actor IS NOT NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              IF FOUND
                 AND v_session.ended_at IS NULL
                 AND v_session.state = 'entry'::public.video_date_state
                 AND v_session.date_started_at IS NULL
                 AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
                 AND v_session.entry_started_at IS NOT NULL
                 AND v_session.entry_started_at + interval '60 seconds' <= now() THEN
                v_result := public.finalize_video_date_entry_deadline(
                  p_session_id,
                  v_actor,
                  'late_' || v_delegate_action || '_after_entry_deadline',
                  p_reason
                );
                EXIT deep;
              END IF;
            END IF;

            -- prepare_entry: lease grant/refresh, event-inactive block, then
            -- preflight-only checks (formerly vdt_prepare_payload,
            -- vdt_deadline and vdt_peer_missing_end). Room/token minting
            -- stays in the daily-room Edge Function.
            IF v_delegate_action = 'prepare_entry' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

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
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;
              v_state_before := v_session.state::text;
              v_is_p1 := (v_p1 = v_actor);

              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Access denied',
                  'code', 'ACCESS_DENIED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;

              -- Lease grant/refresh on a virgin both_ready gate.
              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
                OR v_session.daily_room_name IS NOT NULL
                OR v_session.daily_room_url IS NOT NULL
                OR v_session.participant_1_joined_at IS NOT NULL
                OR v_session.participant_2_joined_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              );

              IF NOT v_already_entry AND v_session.ended_at IS NULL THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_ev);

                IF v_inactive_reason IS NULL THEN
                  v_active_lease := (
                    v_session.prepare_entry_expires_at IS NOT NULL
                    AND v_session.prepare_entry_expires_at > v_now
                  );
                  v_gate_live := (
                    v_session.ready_gate_status = 'both_ready'
                    AND v_session.ready_gate_expires_at IS NOT NULL
                    AND v_session.ready_gate_expires_at > v_now
                  );

                  IF v_session.state = 'ready_gate'::public.video_date_state
                     AND v_session.ready_gate_status = 'both_ready'
                     AND (v_gate_live OR v_active_lease)
                     AND v_session.date_started_at IS NULL
                     AND v_session.entry_started_at IS NULL
                     AND v_session.daily_room_name IS NULL
                     AND v_session.daily_room_url IS NULL
                     AND v_session.participant_1_joined_at IS NULL
                     AND v_session.participant_2_joined_at IS NULL THEN
                    v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
                    v_lease_expires_at := GREATEST(
                      COALESCE(v_session.prepare_entry_expires_at, v_now),
                      v_now + interval '90 seconds'
                    );

                    UPDATE public.video_sessions
                    SET
                      prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now),
                      prepare_entry_expires_at = v_lease_expires_at,
                      prepare_entry_attempt_id = COALESCE(NULLIF(prepare_entry_attempt_id, ''), v_attempt_id),
                      prepare_entry_actor_id = COALESCE(prepare_entry_actor_id, v_actor),
                      ready_gate_expires_at = GREATEST(
                        COALESCE(ready_gate_expires_at, v_now),
                        v_lease_expires_at
                      ),
                      state_updated_at = v_now
                    WHERE id = p_session_id
                      AND ended_at IS NULL
                      AND state = 'ready_gate'::public.video_date_state
                      AND ready_gate_status = 'both_ready'
                      AND date_started_at IS NULL
                      AND entry_started_at IS NULL
                      AND daily_room_name IS NULL
                      AND daily_room_url IS NULL
                      AND participant_1_joined_at IS NULL
                      AND participant_2_joined_at IS NULL
                    RETURNING * INTO v_session;

                    IF FOUND THEN
                      PERFORM public.record_event_loop_observability(
                        'video_date_transition',
                        'success',
                        CASE
                          WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_lease_started'
                          ELSE 'prepare_entry_lease_refreshed'
                        END,
                        NULL,
                        v_session.event_id,
                        v_actor,
                        p_session_id,
                        jsonb_build_object(
                          'action', v_delegate_action,
                          'p_reason', p_reason,
                          'entry_attempt_id', v_attempt_id,
                          'prepare_entry_started_at', v_session.prepare_entry_started_at,
                          'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
                          'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
                          'ready_gate_expires_at', v_session.ready_gate_expires_at,
                          'routeable', false
                        )
                      );
                    END IF;
                  END IF;
                END IF;
              END IF;

              -- The chain re-read the row between generations; keep the row
              -- image current after the conditional lease write.
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              -- Block stale both_ready -> Daily handoff after event
              -- inactivity, while preserving already-prepared entries.
              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
                OR v_session.daily_room_name IS NOT NULL
                OR v_session.daily_room_url IS NOT NULL
                OR v_session.participant_1_joined_at IS NOT NULL
                OR v_session.participant_2_joined_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              );

              IF NOT v_already_entry THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_ev);

                IF v_inactive_reason IS NOT NULL THEN
                  v_cleanup := public.terminalize_event_ready_gates(v_ev, v_inactive_reason);

                  SELECT *
                  INTO v_session
                  FROM public.video_sessions
                  WHERE id = p_session_id;

                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'blocked',
                    'prepare_entry_event_inactive',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', v_delegate_action,
                      'p_reason', p_reason,
                      'inactive_reason', v_inactive_reason,
                      'cleanup', v_cleanup
                    )
                  );

                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'Event is no longer active',
                    'code', 'READY_GATE_NOT_READY',
                    'error_code', 'EVENT_NOT_ACTIVE',
                    'reason', 'event_not_active',
                    'inactive_reason', v_inactive_reason,
                    'state', COALESCE(v_session.state::text, 'ended'),
                    'phase', COALESCE(v_session.phase, 'ended'),
                    'event_id', v_session.event_id,
                    'participant_1_id', v_session.participant_1_id,
                    'participant_2_id', v_session.participant_2_id,
                    'entry_started_at', v_session.entry_started_at,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'terminal', v_session.ended_at IS NOT NULL
                  );
                  EXIT deep;
                END IF;
              END IF;

              -- Preflight-only checks; no state mutation on success.
              v_actor_away_at := CASE WHEN v_is_p1 THEN v_session.participant_1_away_at ELSE v_session.participant_2_away_at END;

              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', 'ended',
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', COALESCE(v_session.phase, 'ended'),
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              SELECT EXISTS (
                SELECT 1
                FROM public.blocked_users bu
                WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
                   OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
              ) INTO v_blocked;

              IF v_blocked THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'This call is no longer available.',
                  'code', 'BLOCKED_PAIR',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_actor_away_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at IS NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Reconnect sync required before prepare entry',
                  'code', 'RECONNECT_SYNC_REQUIRED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR v_session.date_started_at IS NOT NULL
              );

              v_gate_live := (
                COALESCE(v_session.ready_gate_status, '') = 'both_ready'
                AND v_session.ready_gate_expires_at IS NOT NULL
                AND v_session.ready_gate_expires_at > v_now
              );

              IF NOT v_already_entry AND NOT v_gate_live THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'prepare_entry_ready_gate_not_ready',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'p_reason', p_reason,
                    'preflight_only', true
                  )
                );
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Both participants must be ready before starting the video date',
                  'code', 'READY_GATE_NOT_READY',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_already_entry THEN 'prepare_entry_preflight_already_active' ELSE 'prepare_entry_preflight_ok' END,
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'phase_after', v_session.phase,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'registration_status', 'deferred_until_confirm_prepare_entry',
                  'preflight_only', true,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'code', 'OK',
                'preflight_only', true,
                'state', v_session.state::text,
                'phase', v_session.phase,
                'event_id', v_ev,
                'participant_1_id', v_p1,
                'participant_2_id', v_p2,
                'entry_started_at', v_session.entry_started_at,
                'ready_gate_status', v_session.ready_gate_status,
                'ready_gate_expires_at', v_session.ready_gate_expires_at
              );
              EXIT deep;
            END IF;

            -- end: partial-join peer timeout (formerly vdt_event_inactive),
            -- then pre-date-aware cleanup (formerly vdt_pre_date_end_cleanup).
            IF v_delegate_action = 'end' THEN
              v_canonical_reason := CASE
                WHEN lower(btrim(COALESCE(p_reason, ''))) IN ('partial_join_peer_timeout', 'peer_missing_timeout')
                  THEN 'partial_join_peer_timeout'
                ELSE NULL
              END;
              v_effective_reason := p_reason;

              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

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
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;

              IF v_canonical_reason = 'partial_join_peer_timeout' THEN
                v_is_p1 := v_session.participant_1_id = v_actor;
                IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'blocked',
                    'access_denied',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                  );
                  v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
                  EXIT deep;
                END IF;

                IF v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'state', 'ended',
                    'already_ended', true,
                    'reason', v_session.ended_reason,
                    'survey_eligible', v_session.date_started_at IS NOT NULL
                  );
                  EXIT deep;
                END IF;

                v_reached_date_phase := (
                  v_session.date_started_at IS NOT NULL
                  OR v_session.state = 'date'::public.video_date_state
                  OR v_session.phase = 'date'
                );
                v_exactly_one_joined := (
                  (v_session.participant_1_joined_at IS NULL)
                  <> (v_session.participant_2_joined_at IS NULL)
                );

                IF v_reached_date_phase OR NOT v_exactly_one_joined THEN
                  v_effective_reason := 'ended_from_client';
                ELSE
                  SELECT EXISTS (
                    SELECT 1
                    FROM public.events ev
                    WHERE ev.id = v_session.event_id
                      AND ev.status = 'live'
                      AND ev.archived_at IS NULL
                  ) INTO v_event_live;

                  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;
                  v_joined_participant_id := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_1_id
                    ELSE v_session.participant_2_id
                  END;
                  v_missing_participant_id := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_2_id
                    ELSE v_session.participant_1_id
                  END;
                  v_joined_slot := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN 'participant_1'
                    ELSE 'participant_2'
                  END;

                  UPDATE public.video_sessions
                  SET
                    state = 'ended',
                    phase = 'ended',
                    ended_at = v_now,
                    ended_reason = 'partial_join_peer_timeout',
                    entry_grace_expires_at = NULL,
                    reconnect_grace_ends_at = NULL,
                    participant_1_away_at = NULL,
                    participant_2_away_at = NULL,
                    duration_seconds = COALESCE(
                      duration_seconds,
                      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(entry_started_at, started_at))))::int)
                    ),
                    state_updated_at = v_now
                  WHERE id = p_session_id
                    AND ended_at IS NULL
                    AND date_started_at IS NULL
                    AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL));

                  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
                  IF v_rowcnt = 0 THEN
                    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                    v_result := jsonb_build_object(
                      'success', true,
                      'state', COALESCE(v_session.state::text, 'ended'),
                      'already_ended', v_session.ended_at IS NOT NULL,
                      'reason', v_session.ended_reason,
                      'survey_eligible', v_session.date_started_at IS NOT NULL
                    );
                    EXIT deep;
                  END IF;

                  UPDATE public.event_registrations
                  SET
                    queue_status = v_resume_status,
                    current_room_id = NULL,
                    current_partner_id = NULL,
                    last_active_at = v_now
                  WHERE event_id = v_session.event_id
                    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                    AND current_room_id = p_session_id;

                  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'partial_join_peer_manual_end',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', v_delegate_action,
                      'p_reason', p_reason,
                      'ended_reason', 'partial_join_peer_timeout',
                      'transition', 'entry_to_ended',
                      'watchdog_source', 'client_peer_missing_exit',
                      'joined_participant_id', v_joined_participant_id,
                      'missing_participant_id', v_missing_participant_id,
                      'joined_slot', v_joined_slot,
                      'registration_status', v_resume_status,
                      'survey_eligible', false,
                      'joined_evidence', jsonb_build_object(
                        'participant_1_joined', v_session.participant_1_joined_at IS NOT NULL,
                        'participant_2_joined', v_session.participant_2_joined_at IS NOT NULL,
                        'participant_1_joined_at', v_session.participant_1_joined_at,
                        'participant_2_joined_at', v_session.participant_2_joined_at
                      )
                    )
                  );

                  v_result := jsonb_build_object(
                    'success', true,
                    'state', 'ended',
                    'reason', 'partial_join_peer_timeout',
                    'survey_eligible', false,
                    'registration_status', v_resume_status
                  );
                  EXIT deep;
                END IF;
              END IF;

              -- Pre-date-aware end cleanup. A date-phase row stays
              -- survey-eligible through date_started_at; pre-date rows do not.
              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                v_state_before := v_session.state::text;

                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'reconnect_grace_auto_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', v_effective_reason,
                    'survey_eligible', v_session.date_started_at IS NOT NULL
                  )
                );

                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'reason', 'reconnect_grace_expired',
                  'survey_eligible', v_session.date_started_at IS NOT NULL
                );
                EXIT deep;
              END IF;

              v_is_p1 := (v_p1 = v_actor);
              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'access_denied',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'state_before', v_session.state::text,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', v_effective_reason
                  )
                );
                v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'already_ended', true,
                  'reason', v_session.ended_reason,
                  'survey_eligible', v_session.date_started_at IS NOT NULL
                );
                EXIT deep;
              END IF;

              v_reached_date_phase := (
                v_session.date_started_at IS NOT NULL
                OR v_session.state = 'date'::public.video_date_state
                OR v_session.phase = 'date'
              );

              SELECT EXISTS (
                SELECT 1
                FROM public.events ev
                WHERE ev.id = v_ev
                  AND ev.status = 'live'
                  AND ev.archived_at IS NULL
              ) INTO v_event_live;

              v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

              IF v_reached_date_phase THEN
                v_end_reason := COALESCE(v_effective_reason, v_session.ended_reason, 'ended_by_participant');
              ELSE
                v_end_reason := CASE
                  WHEN COALESCE(v_effective_reason, '') IN (
                    'ready_gate_forfeit',
                    'ready_gate_expired',
                    'queued_ttl_expired',
                    'entry_not_mutual',
                    'entry_grace_expired',
                    'entry_timeout',
                    'blocked_pair',
                    'reconnect_grace_expired'
                  ) THEN v_effective_reason
                  ELSE 'pre_date_manual_end'
                END;
              END IF;

              v_state_before := v_session.state::text;

              UPDATE public.video_sessions
              SET
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = v_end_reason,
                reconnect_grace_ends_at = NULL,
                participant_1_away_at = NULL,
                participant_2_away_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL;

              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt = 0 THEN
                v_result := jsonb_build_object('success', true, 'state', 'ended', 'already_ended', true);
                EXIT deep;
              END IF;

              IF v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              ELSIF v_reached_date_phase THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'in_survey',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              ELSE
                -- Pre-date termination is not survey-eligible. Clear only
                -- registrations still pointing at this session so a newer
                -- ready gate/date cannot be overwritten by stale cleanup.
                UPDATE public.event_registrations
                SET
                  queue_status = v_resume_status,
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              END IF;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_reached_date_phase THEN 'date_end_survey' ELSE 'pre_date_end_cleanup' END,
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'participant_1_decided_at', v_session.participant_1_decided_at,
                  'participant_2_decided_at', v_session.participant_2_decided_at,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', v_effective_reason,
                  'ended_reason', v_end_reason,
                  'survey_eligible', v_reached_date_phase,
                  'registration_resume_status',
                    CASE
                      WHEN v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN 'idle'
                      WHEN v_reached_date_phase THEN 'in_survey'
                      ELSE v_resume_status
                    END
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'ended',
                'reason', v_end_reason,
                'survey_eligible', v_reached_date_phase,
                'registration_status',
                  CASE
                    WHEN v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN 'idle'
                    WHEN v_reached_date_phase THEN 'in_survey'
                    ELSE v_resume_status
                  END
              );
              EXIT deep;
            END IF;

            -- mark_reconnect_self_away (formerly vdt_provider_atomic_entry).
            IF v_delegate_action = 'mark_reconnect_self_away' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

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
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;
              v_state_before := v_session.state::text;
              v_is_p1 := (v_p1 = v_actor);

              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Access denied',
                  'code', 'ACCESS_DENIED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;
              v_partner_away_at := CASE WHEN v_is_p1 THEN v_session.participant_2_away_at ELSE v_session.participant_1_away_at END;

              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', 'ended',
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', COALESCE(v_session.phase, 'ended'),
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              SELECT EXISTS (
                SELECT 1
                FROM public.blocked_users bu
                WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
                   OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
              ) INTO v_blocked;

              IF v_blocked THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'This call is no longer available.',
                  'code', 'BLOCKED_PAIR',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN COALESCE(participant_1_away_at, v_now) ELSE participant_1_away_at END,
                participant_2_away_at = CASE WHEN NOT v_is_p1 THEN COALESCE(participant_2_away_at, v_now) ELSE participant_2_away_at END,
                reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND (state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                  OR phase IN ('entry', 'date'));

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'mark_reconnect_self_away',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'phase_after', v_session.phase,
                  'reason', p_reason,
                  'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'code', 'OK',
                'state', v_session.state::text,
                'phase', v_session.phase,
                'event_id', v_ev,
                'participant_1_id', v_p1,
                'participant_2_id', v_p2,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'partner_marked_away', v_partner_away_at IS NOT NULL
              );
              EXIT deep;
            END IF;

            -- Core legacy machine: sync_reconnect, mark_reconnect_partner_away,
            -- mark_reconnect_return, vibe/pass, unknown actions
            -- (formerly vdt_core_legacy_01).
            IF v_actor IS NULL THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'unauthorized',
                NULL,
                NULL,
                NULL,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
              EXIT deep;
            END IF;

            SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
            IF NOT FOUND THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'session_not_found',
                NULL,
                NULL,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
              EXIT deep;
            END IF;

            v_ev := v_session.event_id;
            v_p1 := v_session.participant_1_id;
            v_p2 := v_session.participant_2_id;

            IF v_session.ended_at IS NULL
               AND v_session.reconnect_grace_ends_at IS NOT NULL
               AND v_session.reconnect_grace_ends_at <= v_now THEN
              v_state_before := v_session.state::text;

              UPDATE public.video_sessions
              SET
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = 'reconnect_grace_expired',
                reconnect_grace_ends_at = NULL,
                participant_1_away_at = NULL,
                participant_2_away_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id;

              UPDATE public.event_registrations
              SET
                queue_status = 'idle',
                current_room_id = NULL,
                current_partner_id = NULL,
                last_active_at = v_now
              WHERE event_id = v_ev
                AND profile_id IN (v_p1, v_p2);

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'reconnect_grace_auto_ended',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'ended',
                'reason', 'reconnect_grace_expired'
              );
              EXIT deep;
            END IF;

            v_is_p1 := (v_p1 = v_actor);
            IF NOT v_is_p1 AND v_p2 != v_actor THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'access_denied',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'state_before', v_session.state::text,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
              EXIT deep;
            END IF;

            SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
            v_ev := v_session.event_id;
            v_p1 := v_session.participant_1_id;
            v_p2 := v_session.participant_2_id;

            IF v_delegate_action = 'sync_reconnect' THEN
              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at,
                'ended', v_session.ended_at IS NOT NULL,
                'ended_reason', v_session.ended_reason,
                'state', v_session.state::text,
                'phase', v_session.phase,
                'partner_marked_away',
                  CASE
                    WHEN v_is_p1 THEN v_session.participant_2_away_at IS NOT NULL
                    ELSE v_session.participant_1_away_at IS NOT NULL
                  END
              );
              EXIT deep;
            END IF;

            IF v_delegate_action = 'mark_reconnect_partner_away' THEN
              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;
              IF v_session.state NOT IN ('entry'::public.video_date_state, 'date'::public.video_date_state) THEN
                v_result := jsonb_build_object('success', false, 'error', 'Not in reconnect-eligible phase', 'code', 'INVALID_PHASE');
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN participant_1_away_at ELSE v_now END,
                participant_2_away_at = CASE WHEN v_is_p1 THEN v_now ELSE participant_2_away_at END,
                reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
                state_updated_at = v_now
              WHERE id = p_session_id;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at
              );
              EXIT deep;
            END IF;

            IF v_delegate_action = 'mark_reconnect_return' THEN
              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN NULL ELSE participant_1_away_at END,
                participant_2_away_at = CASE WHEN v_is_p1 THEN participant_2_away_at ELSE NULL END,
                state_updated_at = v_now
              WHERE id = p_session_id;

              UPDATE public.video_sessions
              SET
                reconnect_grace_ends_at = CASE
                  WHEN participant_1_away_at IS NULL AND participant_2_away_at IS NULL THEN NULL
                  ELSE reconnect_grace_ends_at
                END,
                state_updated_at = v_now
              WHERE id = p_session_id;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at
              );
              EXIT deep;
            END IF;

            IF v_delegate_action IN ('vibe', 'pass') THEN
              v_decision := (v_delegate_action = 'vibe');
              v_state_before := v_session.state::text;
              v_actor_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_1_decided_at ELSE v_session.participant_2_decided_at END;
              v_partner_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_2_decided_at ELSE v_session.participant_1_decided_at END;
              v_waiting_for_self := v_actor_decided_at IS NULL;
              v_waiting_for_partner := v_partner_decided_at IS NULL;

              IF v_session.ended_at IS NOT NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'session_already_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;

              IF v_session.entry_grace_expires_at IS NOT NULL
                 AND v_now >= v_session.entry_grace_expires_at THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = COALESCE(ended_at, v_now),
                  ended_reason = 'entry_grace_expired',
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

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'grace_expired_coerced_to_end',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );

                v_result := jsonb_build_object(
                  'success', false,
                  'code', 'GRACE_EXPIRED',
                  'state', 'ended',
                  'reason', 'entry_grace_expired',
                  'waiting_for_self', v_waiting_for_self,
                  'waiting_for_partner', v_waiting_for_partner,
                  'local_decision_persisted', NOT v_waiting_for_self,
                  'partner_decision_persisted', NOT v_waiting_for_partner
                );
                EXIT deep;
              END IF;

              IF v_is_p1 THEN
                UPDATE public.video_sessions
                SET
                  participant_1_liked = COALESCE(participant_1_liked, v_decision),
                  participant_1_decided_at = COALESCE(participant_1_decided_at, v_now),
                  state_updated_at = v_now
                WHERE id = p_session_id AND ended_at IS NULL;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_liked = COALESCE(participant_2_liked, v_decision),
                  participant_2_decided_at = COALESCE(participant_2_decided_at, v_now),
                  state_updated_at = v_now
                WHERE id = p_session_id AND ended_at IS NULL;
              END IF;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              v_actor_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_1_decided_at ELSE v_session.participant_2_decided_at END;
              v_partner_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_2_decided_at ELSE v_session.participant_1_decided_at END;
              v_waiting_for_self := v_actor_decided_at IS NULL;
              v_waiting_for_partner := v_partner_decided_at IS NULL;

              IF v_session.participant_1_decided_at IS NOT NULL
                 AND v_session.participant_2_decided_at IS NOT NULL
                 AND v_session.participant_1_liked IS TRUE
                 AND v_session.participant_2_liked IS TRUE THEN
                UPDATE public.video_sessions
                SET
                  state = 'date',
                  phase = 'date',
                  date_started_at = COALESCE(date_started_at, v_now),
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
                  current_partner_id = CASE
                    WHEN profile_id = v_p1 THEN v_p2
                    ELSE v_p1
                  END,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'vibe_completed_mutual_advanced_to_date',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
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
                EXIT deep;
              END IF;

              IF v_session.participant_1_decided_at IS NOT NULL
                 AND v_session.participant_2_decided_at IS NOT NULL THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = COALESCE(ended_at, v_now),
                  ended_reason = COALESCE(p_reason, 'entry_not_mutual'),
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

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'vibe_completed_partner_passed_session_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );

                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'reason', v_session.ended_reason,
                  'waiting_for_self', false,
                  'waiting_for_partner', false,
                  'local_decision_persisted', true,
                  'partner_decision_persisted', true
                );
                EXIT deep;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'vibe_recorded_awaiting_partner',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'participant_1_decided_at', v_session.participant_1_decided_at,
                  'participant_2_decided_at', v_session.participant_2_decided_at,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'entry',
                'waiting_for_self', v_waiting_for_self,
                'waiting_for_partner', v_waiting_for_partner,
                'local_decision_persisted', NOT v_waiting_for_self,
                'partner_decision_persisted', NOT v_waiting_for_partner
              );
              EXIT deep;
            END IF;

            v_result := jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
            EXIT deep;
          END LOOP;
        END IF;

        -- ── Inner result posts (formerly vdt_remote_seen / vdt_failsoft_base);
        -- suppression results bypass this tier exactly as in the chain. ──
        IF NOT v_skip_inner_posts THEN
          IF v_delegate_action = 'prepare_entry' THEN
            v_success := CASE
              WHEN jsonb_typeof(v_result -> 'success') = 'boolean' THEN (v_result ->> 'success')::boolean
              ELSE false
            END;

            IF v_success AND v_actor IS NOT NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              IF FOUND
                 AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor) THEN
                v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
                  'event_id', v_session.event_id,
                  'participant_1_id', v_session.participant_1_id,
                  'participant_2_id', v_session.participant_2_id,
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'ended_at', v_session.ended_at,
                  'ended_reason', v_session.ended_reason,
                  'entry_started_at', v_session.entry_started_at,
                  'date_started_at', v_session.date_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'daily_room_name', v_session.daily_room_name,
                  'daily_room_url', v_session.daily_room_url,
                  'daily_room_verified_at', v_session.daily_room_verified_at,
                  'daily_room_expires_at', v_session.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason
                );
              END IF;
            END IF;
          END IF;

          IF COALESCE(v_result ->> 'success', 'false') = 'true'
             AND v_result ->> 'state' = 'date' THEN
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
                v_actor,
                'transition_' || COALESCE(NULLIF(v_delegate_action, ''), 'unknown'),
                p_reason
              );
            END IF;
          ELSIF COALESCE(v_result ->> 'success', 'false') = 'true'
                AND v_result ->> 'state' = 'ended' THEN
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

              v_survey_feedback_complete := v_should_open_survey
                AND EXISTS (
                  SELECT 1
                  FROM public.date_feedback df1
                  WHERE df1.session_id = p_session_id
                    AND df1.user_id = v_session.participant_1_id
                )
                AND EXISTS (
                  SELECT 1
                  FROM public.date_feedback df2
                  WHERE df2.session_id = p_session_id
                    AND df2.user_id = v_session.participant_2_id
                );

              IF v_should_open_survey AND NOT v_survey_feedback_complete THEN
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
                  AND current_room_id = p_session_id;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_should_open_survey AND NOT v_survey_feedback_complete THEN 'terminal_confirmed_encounter_survey' WHEN v_survey_feedback_complete THEN 'terminal_survey_already_complete' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
                NULL,
                v_session.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'reason', p_reason,
                  'ended_reason', v_session.ended_reason,
                  'date_started_at', v_session.date_started_at,
                  'participant_1_joined_at', v_session.participant_1_joined_at,
                  'participant_2_joined_at', v_session.participant_2_joined_at,
                  'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                  'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                  'survey_required', v_should_open_survey AND NOT v_survey_feedback_complete,
                  'resume_status', CASE WHEN v_should_open_survey AND NOT v_survey_feedback_complete THEN 'in_survey' ELSE v_resume_status END
                )
              );
            END IF;

            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey AND NOT v_survey_feedback_complete);
          END IF;

          -- mark_reconnect_return grace clearing
          -- (formerly vdt_lifecycle_presence post-step).
          IF v_norm_action = 'mark_reconnect_return'
             AND COALESCE((v_result ->> 'ok')::boolean, true) THEN
            v_clock_now := clock_timestamp();

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
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              END IF;
              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt > 0 THEN
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
                    'action', v_norm_action,
                    'p_reason', v_norm_reason,
                    'reconnect_grace_cleared', true
                  )
                );
              END IF;
              v_result := v_result || jsonb_build_object('reconnect_grace_cleared', v_rowcnt > 0);
            END IF;
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;

          -- Raw diagnostics go to server-side observability, never into
          -- authenticated client payloads (formerly vdt_routeable_entry,
          -- which leaked sqlstate/message/detail/hint).
          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_date_transition.single_body_core',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;

          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'video_date_transition_failed',
            'reason', 'video_date_transition_failed',
            'code', 'VIDEO_DATE_TRANSITION_FAILED',
            'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
            'retryable', SQLSTATE IS DISTINCT FROM '42501',
            'retry_after_ms', 1500,
            'retry_after_seconds', 2,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
          v_skip_inner_posts := true;
      END;

      -- ── Prepare-lease merge (formerly vdt_terminal_lifecycle post-step) ──
      IF v_delegate_action = 'prepare_entry'
         AND COALESCE(NULLIF(v_result ->> 'success', '')::boolean, false)
         AND COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
        v_result := v_result || jsonb_build_object(
          'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
          'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
          'prepare_entry_attempt_id', v_protection ->> 'prepare_entry_attempt_id',
          'daily_room_name', COALESCE(v_result ->> 'daily_room_name', v_protection ->> 'daily_room_name'),
          'daily_room_url', COALESCE(v_result ->> 'daily_room_url', v_protection ->> 'daily_room_url'),
          'ready_gate_expires_at', COALESCE(v_result ->> 'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at')
        );
      END IF;
    END IF;

    -- ── Lifecycle enrichment + sanitization pipeline (formerly
    -- vdt_definitive_owner -> vdt_last_resort -> vdt_partial_ready_gate). ──
    IF NOT v_skip_middle THEN
      v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
      v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
      v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
      v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_date_transition',
        v_result
      );
    END IF;

    IF NOT v_skip_actionability_mark THEN
      v_result := v_result || jsonb_build_object('ready_gate_actionability_checked', v_norm_action = 'prepare_entry');
    END IF;

    -- ── Route payload + shell markers (formerly vdt_active_entry_failsoft
    -- and the hot-path / flattened shells). ──
    v_result := public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'both_ready_route_owner_checked', v_norm_action = 'prepare_entry'
      ),
      'video_date_transition.both_ready_owner'
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true,
      'standalone_enter_handshake_removed_shell', true,
      'flattened_public_shell', true,
      'single_body_rpc', true
    );

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_date_transition.single_body',
          'video_date_transition_failed',
          'VIDEO_DATE_TRANSITION_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'standalone_enter_handshake_removed_shell', true,
          'flattened_public_shell', true,
          'single_body_rpc', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'video_date_transition',
            'action', v_action,
            'reason_detail', left(btrim(COALESCE(p_reason, '')), 180),
            'error', 'video_date_transition_failed',
            'reason', 'video_date_transition_failed',
            'code', 'VIDEO_DATE_TRANSITION_FAILED',
            'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
            'retryable', true,
            'terminal', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'standalone_enter_handshake_removed_shell', true,
            'flattened_public_shell', true,
            'single_body_rpc', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$
;
