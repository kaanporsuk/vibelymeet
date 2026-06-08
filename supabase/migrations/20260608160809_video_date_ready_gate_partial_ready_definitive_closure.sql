-- Video Date Ready Gate partial-ready definitive closure.
--
-- Applied migration history is immutable. This follow-up adds a single
-- server-side actionability gate for the ready_a/ready_b boundary, wraps the
-- public Ready/prepare RPCs through it, and keeps provider/notification work
-- fail-soft after the ready commit.

BEGIN;

ALTER TABLE public.video_sessions
  DROP CONSTRAINT IF EXISTS video_sessions_ready_gate_timestamp_consistency;

ALTER TABLE public.video_sessions
  ADD CONSTRAINT video_sessions_ready_gate_timestamp_consistency
  CHECK (
    (
      ready_gate_status IS DISTINCT FROM 'ready_a'
      OR (ready_participant_1_at IS NOT NULL AND ready_participant_2_at IS NULL)
    )
    AND (
      ready_gate_status IS DISTINCT FROM 'ready_b'
      OR (ready_participant_2_at IS NOT NULL AND ready_participant_1_at IS NULL)
    )
    AND (
      ready_gate_status IS DISTINCT FROM 'both_ready'
      OR (ready_participant_1_at IS NOT NULL AND ready_participant_2_at IS NOT NULL)
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.video_date_terminalize_ready_gate_session_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'ready_gate_actionability_invalid',
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'ready_gate_actionability_invalid');
  v_terminal_status text;
  v_row_count integer := 0;
  v_registration_rows integer := 0;
  v_message text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'terminalized', false
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'terminalized', false
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state = 'ended'::public.video_date_state
     OR COALESCE(v_session.phase, '') = 'ended'
     OR COALESCE(v_session.ready_gate_status, '') IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ended_reason', COALESCE(v_session.ended_reason, v_reason),
      'terminal', true,
      'terminalized', false,
      'already_terminal', true
    );
  END IF;

  IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'code', 'NOT_TERMINALIZABLE',
      'error', 'not_terminalizable',
      'terminal', false,
      'terminalized', false
    );
  END IF;

  v_terminal_status := CASE
    WHEN v_reason IN (
      'ready_gate_expired',
      'ready_gate_event_archived',
      'ready_gate_event_cancelled',
      'ready_gate_event_ended',
      'ready_gate_event_inactive'
    ) THEN 'expired'
    ELSE 'forfeited'
  END;

  UPDATE public.video_sessions
  SET
    ready_gate_status = v_terminal_status,
    ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
    queued_expires_at = NULL,
    snoozed_by = NULL,
    snooze_expires_at = NULL,
    daily_room_name = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_name ELSE NULL END,
    daily_room_url = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_url ELSE NULL END,
    daily_room_verified_at = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_verified_at ELSE NULL END,
    daily_room_expires_at = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_expires_at ELSE NULL END,
    daily_room_provider_verify_reason = CASE
      WHEN v_session.ready_gate_status = 'both_ready'
        THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_actionability_terminal_diagnostic')
      ELSE NULL
    END,
    prepare_entry_started_at = NULL,
    prepare_entry_expires_at = NULL,
    prepare_entry_attempt_id = NULL,
    prepare_entry_actor_id = NULL,
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = v_now,
    ended_reason = COALESCE(ended_reason, v_reason),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
    AND handshake_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
    AND COALESCE(phase, 'ready_gate') NOT IN ('handshake', 'date')
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'code', 'TERMINALIZE_LOST_RACE',
      'error', 'terminalize_lost_race',
      'retryable', true,
      'terminalized', false
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now,
    updated_at = v_now
  WHERE event_id = v_after.event_id
    AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
    AND queue_status IS DISTINCT FROM 'in_survey'
    AND (
      current_room_id = v_after.id
      OR queue_status = 'in_ready_gate'
      OR current_partner_id IN (v_after.participant_1_id, v_after.participant_2_id)
    );

  GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

  BEGIN
    PERFORM public.record_event_loop_observability(
      'ready_gate_transition',
      'success',
      v_reason,
      NULL,
      v_after.event_id,
      p_actor_id,
      p_session_id,
      jsonb_build_object(
        'action', 'ready_gate_actionability_terminalize',
        'reason', v_reason,
        'status_before', v_session.ready_gate_status,
        'status_after', v_after.ready_gate_status,
        'registration_rows', v_registration_rows,
        'detail', COALESCE(p_detail, '{}'::jsonb)
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  IF COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_session.daily_room_name, '')) IS NOT NULL
     AND v_after.ready_gate_status IS DISTINCT FROM 'both_ready' THEN
    BEGIN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'daily.delete_video_date_room',
        jsonb_build_object(
          'roomName', COALESCE(NULLIF(v_session.daily_room_name, ''), NULLIF(v_after.daily_room_name, '')),
          'source', 'video_date_terminalize_ready_gate_session_v1',
          'reason', v_reason
        ),
        'phase3:delete_room:' || p_session_id::text || ':' || v_reason,
        v_now
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        p_detail := COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
          'delete_room_enqueue_degraded', true,
          'delete_room_enqueue_sqlstate', SQLSTATE,
          'delete_room_enqueue_message', v_message
        );
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'session_id', v_after.id,
    'event_id', v_after.event_id,
    'status', v_after.ready_gate_status,
    'ready_gate_status', v_after.ready_gate_status,
    'result_status', v_after.ready_gate_status,
    'result_ready_gate_status', v_after.ready_gate_status,
    'reason', v_reason,
    'error_code', upper(v_reason),
    'ended_reason', v_after.ended_reason,
    'terminal', true,
    'terminalized', true,
    'registration_rows', v_registration_rows,
    'detail', COALESCE(p_detail, '{}'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates(
  p_event_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_inactive_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_terminal_reason text;
  v_total integer := 0;
  r public.video_sessions%ROWTYPE;
  v_terminalize jsonb;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_event_id',
      'terminalized', 0
    );
  END IF;

  IF v_inactive_reason IS NULL THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  END IF;

  IF v_inactive_reason IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'inactive_reason', NULL,
      'terminalized', 0
    );
  END IF;

  v_terminal_reason := CASE v_inactive_reason
    WHEN 'event_archived' THEN 'ready_gate_event_archived'
    WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
    WHEN 'event_ended' THEN 'ready_gate_event_ended'
    WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
    ELSE 'ready_gate_event_inactive'
  END;

  -- Daily room metadata alone is not provider-prepared/date-capable evidence.
  -- Exclude only rows already owned by handshake/date or concrete Daily join proof.
  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.handshake_started_at IS NULL
      AND vs.date_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND COALESCE(vs.phase, 'ready_gate') NOT IN ('handshake', 'date')
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.queued_expires_at, vs.started_at), vs.id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
      r.id,
      NULL,
      v_terminal_reason,
      jsonb_build_object(
        'source', 'terminalize_event_ready_gates',
        'inactive_reason', v_inactive_reason,
        'previous_ready_gate_status', r.ready_gate_status,
        'previous_state', r.state::text,
        'previous_phase', r.phase,
        'previous_daily_room_name_present', NULLIF(r.daily_room_name, '') IS NOT NULL,
        'previous_daily_room_url_present', NULLIF(r.daily_room_url, '') IS NOT NULL,
        'room_metadata_not_provider_prepared_evidence', true
      )
    );

    IF lower(COALESCE(v_terminalize ->> 'terminalized', 'false')) IN ('true', 't', '1', 'yes') THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'inactive_reason', v_inactive_reason,
    'terminal_reason', v_terminal_reason,
    'terminalized', v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid(),
  p_source text DEFAULT 'video_date_ready_gate_actionability_v1',
  p_allow_actor_owned_snooze boolean DEFAULT false,
  p_require_current_ready_gate_registration boolean DEFAULT true,
  p_terminalize_invalid boolean DEFAULT false,
  p_lock_rows boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_message text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
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
    RETURN jsonb_build_object(
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
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object(
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

  v_status := COALESCE(v_session.ready_gate_status, 'queued');
  v_partner_id := CASE
    WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state = 'ended'::public.video_date_state
     OR COALESCE(v_session.phase, '') = 'ended'
     OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
    RETURN jsonb_build_object(
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
  END IF;

  IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
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
  END IF;

  IF v_status = 'queued' THEN
    RETURN jsonb_build_object(
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
  END IF;

  IF v_status = 'snoozed'
     AND (
       p_allow_actor_owned_snooze IS NOT TRUE
       OR v_session.snoozed_by IS NULL
       OR v_session.snoozed_by IS DISTINCT FROM v_actor
       OR (v_session.snooze_expires_at IS NOT NULL AND v_session.snooze_expires_at <= v_now)
     ) THEN
    RETURN jsonb_build_object(
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
  END IF;

  IF v_status NOT IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    RETURN jsonb_build_object(
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

    RETURN COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
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

  IF v_session.ready_gate_expires_at IS NOT NULL
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

    RETURN COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
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

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      RETURN jsonb_build_object(
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
        'source', v_source,
        'message', v_message
      );
  END;

  IF v_inactive_reason IS NOT NULL THEN
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

    RETURN COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
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
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      RETURN jsonb_build_object(
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
        'source', v_source,
        'message', v_message
      );
  END;

  IF v_is_blocked OR v_has_report OR v_actor_hidden OR v_partner_hidden THEN
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

    RETURN COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
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

  IF p_require_current_ready_gate_registration THEN
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

      RETURN COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
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

  RETURN jsonb_build_object(
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
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
      'error_code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
      'error', 'ready_gate_actionability_unavailable',
      'reason', 'ready_gate_actionability_unavailable',
      'retryable', true,
      'terminal', false,
      'source', v_source,
      'sqlstate', SQLSTATE,
      'message', v_message
    );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_mark_ready_partial_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO vd_mark_ready_partial_base;
  END IF;

  IF to_regprocedure('public.vd_start_snapshot_partial_base(uuid)') IS NULL
     AND to_regprocedure('public.get_video_date_start_snapshot_v1(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.get_video_date_start_snapshot_v1(uuid)
      RENAME TO vd_start_snapshot_partial_base;
  END IF;

  IF to_regprocedure('public.vd_transition_partial_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO vd_transition_partial_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_mark_ready_partial_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_mark_ready_partial_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_start_snapshot_partial_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_start_snapshot_partial_base(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_transition_partial_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_transition_partial_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_precheck jsonb;
  v_result jsonb;
  v_success boolean := false;
  v_status text;
  v_event_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner_id uuid;
  v_notification_degraded boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  v_precheck := public.video_date_ready_gate_actionability_v1(
    p_session_id,
    v_actor,
    'video_session_mark_ready_v2',
    false,
    true,
    true,
    true
  );

  IF lower(COALESCE(v_precheck ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
    RETURN v_precheck
      - 'sqlstate'
      - 'message'
      - 'detail'
      - 'hint'
      - 'context'
      || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'commandStatus', 'rejected',
        'decisive_mark_ready_prechecked', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END IF;

  v_result := public.vd_mark_ready_partial_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_success := lower(COALESCE(v_result ->> 'success', v_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
  v_status := COALESCE(
    NULLIF(v_result ->> 'ready_gate_status', ''),
    NULLIF(v_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_result ->> 'status', '')
  );
  v_event_id := NULLIF(v_result ->> 'event_id', '')::uuid;
  v_p1 := NULLIF(v_result ->> 'participant_1_id', '')::uuid;
  v_p2 := NULLIF(v_result ->> 'participant_2_id', '')::uuid;
  v_partner_id := CASE
    WHEN v_actor IS NOT NULL AND v_actor = v_p1 THEN v_p2
    WHEN v_actor IS NOT NULL AND v_actor = v_p2 THEN v_p1
    ELSE NULL
  END;

  IF v_success
     AND v_status IN ('ready_a', 'ready_b')
     AND v_partner_id IS NOT NULL THEN
    BEGIN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'notification.send',
        jsonb_build_object(
          'user_id', v_partner_id,
          'recipient_id', v_partner_id,
          'match_user_id', v_actor,
          'category', 'partner_ready',
          'title', 'Your match is ready!',
          'body', 'Tap to start your video date',
          'data', jsonb_build_object(
            'session_id', p_session_id,
            'event_id', v_event_id,
            'ready_gate_status', v_status,
            'actor_id', v_actor,
            'source', 'video_session_mark_ready_v2_first_ready'
          ),
          'dedupe_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
          'provider_idempotency_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
          'source', 'video_session_mark_ready_v2',
          'event_id', v_event_id,
          'session_id', p_session_id,
          'actor_id', v_actor
        ),
        'notification:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
        now()
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_notification_degraded := true;
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'ready_gate_actionability_checked', true,
    'partner_ready_notification_degraded', v_notification_degraded
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
        'video_session_mark_ready_v2.partial_ready_closure',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_actionability jsonb;
  v_status text;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.vd_start_snapshot_partial_base(p_session_id);
  v_status := COALESCE(
    NULLIF(v_result ->> 'ready_gate_status', ''),
    NULLIF(v_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_result ->> 'status', '')
  );

  IF lower(COALESCE(v_result ->> 'success', v_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes')
     AND v_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    v_actionability := public.video_date_ready_gate_actionability_v1(
      p_session_id,
      v_actor,
      'get_video_date_start_snapshot_v1',
      false,
      true,
      false,
      false
    );

    IF lower(COALESCE(v_actionability ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
      v_result := v_result || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'ready_gate_actionability_ok', false,
        'ready_gate_actionability_code', COALESCE(v_actionability ->> 'code', v_actionability ->> 'error_code'),
        'ready_gate_actionability_reason', COALESCE(v_actionability ->> 'reason', v_actionability ->> 'error'),
        'registration_desync', COALESCE(lower(COALESCE(v_actionability ->> 'registration_desync', 'false')) IN ('true', 't', '1', 'yes'), false),
        'can_mark_ready', false,
        'canMarkReady', false,
        'can_enter_date', false,
        'canEnterDate', false,
        'allowedActions', '[]'::jsonb,
        'retryable', lower(COALESCE(v_actionability ->> 'retryable', v_result ->> 'retryable', 'false')) IN ('true', 't', '1', 'yes'),
        'terminal', lower(COALESCE(v_actionability ->> 'terminal', v_result ->> 'terminal', 'false')) IN ('true', 't', '1', 'yes')
      );
    ELSE
      v_result := v_result || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'ready_gate_actionability_ok', true
      );
    END IF;
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_exception_payload_v2(
      p_session_id,
      v_actor,
      'get_video_date_start_snapshot_v1',
      'start_snapshot_failed',
      'START_SNAPSHOT_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

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
  v_action text := lower(COALESCE(NULLIF(btrim(p_action), ''), ''));
  v_actionability jsonb;
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  IF v_action = 'prepare_entry' THEN
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
      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
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
    END IF;
  END IF;

  v_result := public.vd_transition_partial_base(
    p_session_id,
    p_action,
    p_reason
  );

  RETURN v_result || jsonb_build_object('ready_gate_actionability_checked', v_action = 'prepare_entry');
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_exception_payload_v2(
      p_session_id,
      v_actor,
      'video_date_transition.partial_ready_closure',
      'video_date_transition_failed',
      'VIDEO_DATE_TRANSITION_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_partial_ready_diagnostics_v1(
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_rows jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.ready_gate_expires_at,
      vs.daily_room_name,
      vs.daily_room_url,
      vs.prepare_entry_expires_at,
      vs.state,
      vs.phase,
      vs.started_at,
      vs.state_updated_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND vs.ready_gate_status IN ('ready_a', 'ready_b', 'snoozed')
      AND (p_event_id IS NULL OR vs.event_id = p_event_id)
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.state_updated_at, vs.started_at) ASC
    LIMIT v_limit
  ),
  joined AS (
    SELECT
      c.*,
      er1.queue_status AS participant_1_queue_status,
      er1.current_room_id AS participant_1_current_room_id,
      er1.current_partner_id AS participant_1_current_partner_id,
      er2.queue_status AS participant_2_queue_status,
      er2.current_room_id AS participant_2_current_room_id,
      er2.current_partner_id AS participant_2_current_partner_id,
      e1.inserted_at AS participant_1_ready_gate_entered_at,
      e2.inserted_at AS participant_2_ready_gate_entered_at
    FROM candidates c
    LEFT JOIN public.event_registrations er1
      ON er1.event_id = c.event_id
     AND er1.profile_id = c.participant_1_id
    LEFT JOIN public.event_registrations er2
      ON er2.event_id = c.event_id
     AND er2.profile_id = c.participant_2_id
    LEFT JOIN LATERAL (
      SELECT e.inserted_at
      FROM public.video_date_ready_gate_entries e
      WHERE e.video_session_id = c.id
        AND e.profile_id = c.participant_1_id
      ORDER BY e.inserted_at DESC
      LIMIT 1
    ) e1 ON true
    LEFT JOIN LATERAL (
      SELECT e.inserted_at
      FROM public.video_date_ready_gate_entries e
      WHERE e.video_session_id = c.id
        AND e.profile_id = c.participant_2_id
      ORDER BY e.inserted_at DESC
      LIMIT 1
    ) e2 ON true
  ),
  evaluated AS (
    SELECT
      j.*,
      array_remove(ARRAY[
        CASE WHEN j.ready_gate_status = 'ready_a' AND j.ready_participant_1_at IS NULL THEN 'ready_a_missing_participant_1_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_a' AND j.ready_participant_2_at IS NOT NULL THEN 'ready_a_has_participant_2_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_b' AND j.ready_participant_2_at IS NULL THEN 'ready_b_missing_participant_2_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_b' AND j.ready_participant_1_at IS NOT NULL THEN 'ready_b_has_participant_1_timestamp' END,
        CASE WHEN j.participant_1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
        CASE WHEN j.participant_2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END,
        CASE WHEN j.participant_1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_room_mismatch' END,
        CASE WHEN j.participant_2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_room_mismatch' END,
        CASE WHEN j.participant_1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
        CASE WHEN j.participant_2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
        CASE WHEN j.ready_gate_expires_at IS NOT NULL AND j.ready_gate_expires_at <= now() THEN 'partial_ready_expired' END
      ]::text[], NULL) AS issues
    FROM joined j
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'session_id', e.id,
        'event_id', e.event_id,
        'ready_gate_status', e.ready_gate_status,
        'ready_participant_1_at', e.ready_participant_1_at,
        'ready_participant_2_at', e.ready_participant_2_at,
        'ready_gate_expires_at', e.ready_gate_expires_at,
        'daily_room_present', e.daily_room_name IS NOT NULL OR e.daily_room_url IS NOT NULL,
        'prepare_entry_expires_at', e.prepare_entry_expires_at,
        'participant_1_queue_status', e.participant_1_queue_status,
        'participant_2_queue_status', e.participant_2_queue_status,
        'participant_1_ready_gate_entered_at', e.participant_1_ready_gate_entered_at,
        'participant_2_ready_gate_entered_at', e.participant_2_ready_gate_entered_at,
        'issues', to_jsonb(e.issues)
      )
      ORDER BY COALESCE(e.ready_gate_expires_at, e.state_updated_at, e.started_at) ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM evaluated e;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'generated_at', now(),
    'event_id', p_event_id,
    'count', jsonb_array_length(v_rows),
    'sessions', v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_terminalize_ready_gate_session_v1(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_terminalize_ready_gate_session_v1(uuid, uuid, text, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.terminalize_event_ready_gates(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminalize_event_ready_gates(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_partial_ready_diagnostics_v1(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_partial_ready_diagnostics_v1(uuid, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON CONSTRAINT video_sessions_ready_gate_timestamp_consistency ON public.video_sessions IS
  'Enforces new ready_a/ready_b/both_ready timestamp consistency. Added NOT VALID to avoid rewriting historical rows while protecting new writes.';
COMMENT ON FUNCTION public.video_date_terminalize_ready_gate_session_v1(uuid, uuid, text, jsonb) IS
  'Service-only terminalizer for pre-date Ready Gate sessions that become invalid through safety, registration, event, expiry, or status/timestamp drift.';
COMMENT ON FUNCTION public.terminalize_event_ready_gates(uuid, text) IS
  'Internal Ready Gate cleanup for inactive events. Terminalizes pre-date ready_gate rows even if room metadata was warmed, excludes route-owned handshake/date and Daily-joined evidence, and delegates cleanup through video_date_terminalize_ready_gate_session_v1.';
COMMENT ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean) IS
  'Canonical Ready Gate actionability gate for mark_ready and prepare_entry. Checks participant authority, snooze, expiry, event activity, safety/privacy, registration/session drift, and ready timestamp invariants.';
COMMENT ON FUNCTION public.video_date_partial_ready_diagnostics_v1(uuid, integer) IS
  'Service-only diagnostics for active partial-ready Ready Gates, including registration pointers, entry proof, room metadata presence, and status/timestamp issues.';
COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant-owned Ready Gate mark-ready wrapper with canonical actionability precheck, strict snooze blocking, registration drift terminalization, and fail-soft first-ready partner notification outbox.';
COMMENT ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) IS
  'Authoritative Video Date start snapshot wrapped with canonical Ready Gate actionability so queued, snoozed, safety-invalid, and registration-drift sessions cannot advertise mark_ready.';
COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date transition fail-soft wrapper with canonical Ready Gate actionability before prepare_entry can persist routeable date state or trigger provider work.';

NOTIFY pgrst, 'reload schema';

COMMIT;
