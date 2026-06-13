-- Review comments 1298-1305 follow-up (Codex P1 on PR #1304).
--
-- video_date_ready_gate_actionability_v1 evaluated the non-ready-gate
-- ownership shortcut (state IS DISTINCT FROM 'ready_gate' -> ok/success: true,
-- non_ready_gate_owned) BEFORE the terminal SESSION_ENDED branch. An ended
-- session has state = 'ended', which satisfies the DISTINCT-FROM test, so
-- terminal sessions were reported as actionable; callers such as
-- video_session_mark_ready_v2 and video_date_transition.prepare_entry could
-- then churn on no-longer-mutable rows instead of returning terminal
-- SESSION_ENDED immediately. This forward migration is a single-body
-- CREATE OR REPLACE that reorders the terminal check ahead of the
-- non-ready-gate shortcut (matching the previous owner-eligibility body).
-- No signature, grant, or other branch changes.

CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1(p_session_id uuid, p_actor_id uuid DEFAULT auth.uid(), p_source text DEFAULT 'video_date_ready_gate_actionability_v1'::text, p_allow_actor_owned_snooze boolean DEFAULT false, p_require_current_ready_gate_registration boolean DEFAULT true, p_terminalize_invalid boolean DEFAULT false, p_lock_rows boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_date_ready_gate_actionability_v1.single_body_core (rebuild PR 4):
-- owner-eligibility matrix + participant eligibility + route payload wrap.
DECLARE
  v_now timestamptz := now();
  v_actor uuid := p_actor_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_ready_gate_actionability_v1');
  v_session public.video_sessions%ROWTYPE;
  v_status text;
  v_partner_id uuid;
  v_inactive_reason text;
  v_terminal_reason text;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_p1_queue_status text;
  v_p2_queue_status text;
  v_p1_current_room_id uuid;
  v_p2_current_room_id uuid;
  v_p1_current_partner_id uuid;
  v_p2_current_partner_id uuid;
  v_p1_registration_found boolean := false;
  v_p2_registration_found boolean := false;
  v_registration_issues text[] := ARRAY[]::text[];
  v_timestamp_issue text := NULL;
  v_terminalize jsonb;
  v_base jsonb := NULL;
  v_actor_eligibility jsonb := '{}'::jsonb;
  v_partner_eligibility jsonb := '{}'::jsonb;
  v_invalid_eligibility jsonb := '{}'::jsonb;
  v_actor_ok boolean := true;
  v_partner_ok boolean := true;
  v_invalid_role text := NULL;
  v_invalid_retryable boolean := false;
  v_invalid_terminal boolean := true;
  v_invalid_code text;
  v_invalid_reason text;
  v_invalid_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── Owner-eligibility matrix (formerly the owner_eligibility base). Every
  -- failure returns through the route-payload wrap below; v_base stays NULL
  -- until the matrix decides. ──
  IF v_actor IS NULL THEN
    v_base := jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'AUTH_REQUIRED',
      'error_code', 'AUTH_REQUIRED',
      'error', 'auth_required',
      'reason', 'auth_required',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    IF p_lock_rows THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;
    ELSE
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;
    END IF;

    IF NOT FOUND THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'SESSION_NOT_FOUND',
        'error_code', 'SESSION_NOT_FOUND',
        'error', 'session_not_found',
        'reason', 'session_not_found',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'code', 'ACCESS_DENIED',
        'error_code', 'ACCESS_DENIED',
        'error', 'not_participant',
        'reason', 'not_participant',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    v_status := COALESCE(v_session.ready_gate_status, 'queued');
    v_partner_id := CASE
      WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END;

    -- Terminal check first: an ended session has state = 'ended', which also
    -- satisfies the non-ready-gate DISTINCT-FROM test below, so it must be
    -- resolved as terminal SESSION_ENDED before the non_ready_gate_owned
    -- shortcut can report it as actionable (review P1 on PR #1304).
    IF v_session.ended_at IS NOT NULL
       OR v_session.state = 'ended'::public.video_date_state
       OR COALESCE(v_session.phase, '') = 'ended'
       OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'SESSION_ENDED',
        'error_code', 'SESSION_ENDED',
        'error', 'session_ended',
        'reason', COALESCE(v_session.ended_reason, 'session_ended'),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
       OR COALESCE(v_session.phase, 'ready_gate') IN ('entry', 'date')
       OR v_session.entry_started_at IS NOT NULL
       OR v_session.date_started_at IS NOT NULL
       OR v_session.participant_1_joined_at IS NOT NULL
       OR v_session.participant_2_joined_at IS NOT NULL THEN
      v_base := jsonb_build_object(
        'ok', true,
        'success', true,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'actionable', true,
        'source', v_source,
        'non_ready_gate_owned', true
      );
    ELSIF v_status = 'queued' THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_OPEN',
        'error_code', 'READY_GATE_NOT_OPEN',
        'error', 'ready_gate_not_open',
        'reason', 'ready_gate_not_open',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status = 'snoozed'
       AND (
         p_allow_actor_owned_snooze IS NOT TRUE
         OR v_session.snoozed_by IS NULL
         OR v_session.snoozed_by IS DISTINCT FROM v_actor
         OR (v_session.snooze_expires_at IS NOT NULL AND v_session.snooze_expires_at <= v_now)
       ) THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'snoozed_by', v_session.snoozed_by,
        'snooze_expires_at', v_session.snooze_expires_at,
        'code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error_code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'reason', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status NOT IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'READY_GATE_NOT_READY',
        'error', 'ready_gate_not_ready',
        'reason', 'ready_gate_not_ready',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    IF v_status = 'ready_a'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_a_timestamp_mismatch';
    ELSIF v_status = 'ready_b'
       AND (v_session.ready_participant_2_at IS NULL OR v_session.ready_participant_1_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_b_timestamp_mismatch';
    ELSIF v_status = 'both_ready'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NULL) THEN
      v_timestamp_issue := 'both_ready_timestamp_mismatch';
    END IF;

    IF v_timestamp_issue IS NOT NULL THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_status_timestamp_desync',
          jsonb_build_object('source', v_source, 'issue', v_timestamp_issue)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error_code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error', 'ready_gate_status_timestamp_desync',
        'reason', 'ready_gate_status_timestamp_desync',
        'timestamp_issue', v_timestamp_issue,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL
     AND v_session.ready_gate_expires_at IS NOT NULL
     AND v_session.ready_gate_expires_at <= v_now
     AND NOT (
       v_status = 'both_ready'
       AND v_session.prepare_entry_expires_at IS NOT NULL
       AND v_session.prepare_entry_expires_at > v_now
     ) THEN
    IF p_terminalize_invalid THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        v_session.id,
        v_actor,
        'ready_gate_expired',
        jsonb_build_object('source', v_source)
      );
    END IF;

    v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'code', 'READY_GATE_EXPIRED',
      'error_code', 'READY_GATE_EXPIRED',
      'error', 'ready_gate_expired',
      'reason', 'ready_gate_expired',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            v_source || '.event_active_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error_code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error', 'event_active_check_unavailable',
          'reason', 'event_active_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND v_inactive_reason IS NOT NULL THEN
      v_terminal_reason := CASE v_inactive_reason
        WHEN 'event_archived' THEN 'ready_gate_event_archived'
        WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
        WHEN 'event_ended' THEN 'ready_gate_event_ended'
        WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
        ELSE 'ready_gate_event_inactive'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object('source', v_source, 'inactive_reason', v_inactive_reason)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'EVENT_NOT_ACTIVE',
        'error_code', 'EVENT_NOT_ACTIVE',
        'error', 'event_not_active',
        'reason', v_terminal_reason,
        'inactive_reason', v_inactive_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_is_blocked := COALESCE(public.is_blocked(v_session.participant_1_id, v_session.participant_2_id), false);

      SELECT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
           OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
      )
      INTO v_has_report;

      v_actor_hidden := COALESCE(public.is_profile_hidden(v_actor), false);
      v_partner_hidden := COALESCE(public.is_profile_hidden(v_partner_id), false);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            v_source || '.safety_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'SAFETY_CHECK_UNAVAILABLE',
          'error_code', 'SAFETY_CHECK_UNAVAILABLE',
          'error', 'safety_check_unavailable',
          'reason', 'safety_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND (v_is_blocked OR v_has_report OR v_actor_hidden OR v_partner_hidden) THEN
      v_terminal_reason := CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object(
            'source', v_source,
            'blocked_pair', v_is_blocked,
            'reported_pair', v_has_report,
            'actor_hidden', v_actor_hidden,
            'partner_hidden', v_partner_hidden
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error_code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error', v_terminal_reason,
        'reason', v_terminal_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL AND p_require_current_ready_gate_registration THEN
    IF p_lock_rows THEN
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id
      FOR UPDATE;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id
      FOR UPDATE;
    ELSE
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id;
    END IF;

    v_p1_registration_found := COALESCE(v_p1_registration_found, false);
    v_p2_registration_found := COALESCE(v_p2_registration_found, false);

    v_registration_issues := array_remove(ARRAY[
      CASE WHEN NOT v_p1_registration_found THEN 'participant_1_registration_missing' END,
      CASE WHEN NOT v_p2_registration_found THEN 'participant_2_registration_missing' END,
      CASE WHEN v_p1_registration_found AND v_p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
      CASE WHEN v_p2_registration_found AND v_p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_1_current_room_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_2_current_room_mismatch' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_partner_id IS DISTINCT FROM v_session.participant_2_id THEN 'participant_1_partner_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_partner_id IS DISTINCT FROM v_session.participant_1_id THEN 'participant_2_partner_mismatch' END
    ]::text[], NULL);

    IF cardinality(v_registration_issues) > 0 THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_registration_desync',
          jsonb_build_object(
            'source', v_source,
            'registration_issues', to_jsonb(v_registration_issues),
            'participant_1_queue_status', v_p1_queue_status,
            'participant_2_queue_status', v_p2_queue_status,
            'participant_1_current_room_id', v_p1_current_room_id,
            'participant_2_current_room_id', v_p2_current_room_id,
            'participant_1_current_partner_id', v_p1_current_partner_id,
            'participant_2_current_partner_id', v_p2_current_partner_id
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_REGISTRATION_DESYNC',
        'error_code', 'READY_GATE_REGISTRATION_DESYNC',
        'error', 'ready_gate_registration_desync',
        'reason', 'ready_gate_registration_desync',
        'registration_desync', true,
        'registration_issues', to_jsonb(v_registration_issues),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  -- ── Matrix failures: route-payload wrap without eligibility checks
  -- (identical to the former head's not-ok base handling). ──
  IF v_base IS NOT NULL
     AND lower(COALESCE(v_base ->> 'ok', v_base ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'eligibility_checked', false
      ),
      v_source
    );
  END IF;

  IF v_base IS NULL THEN
    v_base := jsonb_build_object(
      'ok', true,
      'success', true,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'status', v_status,
      'ready_gate_status', v_status,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
      'actionable', true,
      'source', v_source,
      'registration_checked', p_require_current_ready_gate_registration,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  -- ── Participant eligibility (former head layer; runs for ok bases,
  -- including the non-ready-gate-owned pass-through, as before). ──
  v_actor_eligibility := public.video_date_participant_eligibility_v1(v_actor, v_source || '.actor');
  v_partner_eligibility := public.video_date_participant_eligibility_v1(v_partner_id, v_source || '.partner');
  v_actor_ok := lower(COALESCE(v_actor_eligibility ->> 'ok', v_actor_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');
  v_partner_ok := lower(COALESCE(v_partner_eligibility ->> 'ok', v_partner_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');

  IF NOT v_actor_ok OR NOT v_partner_ok THEN
    v_invalid_role := CASE WHEN NOT v_actor_ok THEN 'actor' ELSE 'partner' END;
    v_invalid_eligibility := CASE
      WHEN v_invalid_role = 'actor' THEN v_actor_eligibility
      ELSE v_partner_eligibility
    END;
    v_invalid_retryable := lower(COALESCE(v_invalid_eligibility ->> 'retryable', 'false')) IN ('true', 't', '1', 'yes');
    v_invalid_terminal := lower(COALESCE(v_invalid_eligibility ->> 'terminal', 'true')) IN ('true', 't', '1', 'yes');
    v_invalid_code := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'code', ''),
      NULLIF(v_invalid_eligibility ->> 'error_code', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END
    );
    v_invalid_reason := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'reason', ''),
      NULLIF(v_invalid_eligibility ->> 'error', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END
    );

    v_terminalize := NULL;
    IF p_terminalize_invalid AND NOT v_invalid_retryable AND v_invalid_terminal THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        p_session_id,
        v_actor,
        CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END,
        jsonb_build_object(
          'source', v_source,
          'invalid_role', v_invalid_role,
          'actor_eligibility', v_actor_eligibility,
          'partner_eligibility', v_partner_eligibility
        )
      );
    END IF;

    v_invalid_payload := COALESCE(v_terminalize, '{}'::jsonb)
      || COALESCE(v_base, '{}'::jsonb)
      || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error_code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'reason', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'retryable', v_invalid_retryable,
        'terminal', NOT v_invalid_retryable AND v_invalid_terminal,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'eligibility_retryable', v_invalid_retryable,
        'eligibility_terminal', v_invalid_terminal,
        'eligibility_code', v_invalid_code,
        'actor_eligibility', v_actor_eligibility,
        'partner_eligibility', v_partner_eligibility,
        'invalid_eligibility_role', v_invalid_role,
        'source', v_source
      );

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_invalid_payload,
      v_source
    );
  END IF;

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
      'ready_gate_actionability_checked', true,
      'eligibility_checked', true,
      'actor_eligibility_ok', true,
      'partner_eligibility_ok', true
    ),
    v_source
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    BEGIN
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        v_actor,
        v_source,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error_code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error', 'ready_gate_actionability_unavailable',
        'reason', 'ready_gate_actionability_unavailable',
        'retryable', true,
        'terminal', false,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'single_body_rpc', true,
        'source', v_source
      ),
      v_source
    );
END;
$function$;

