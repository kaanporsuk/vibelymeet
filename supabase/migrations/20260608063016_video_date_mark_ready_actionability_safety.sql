-- Video Date Ready Gate actionability/safety closure.
--
-- Applied history is immutable. This migration patches the current public
-- mark-ready RPC and start snapshot without rewriting prior migrations.

BEGIN;

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
  v_session public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_protection jsonb;
  v_ready_gate_status text;
  v_partner_id uuid;
  v_success boolean := false;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_message text;
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'auth_required',
      'reason', 'auth_required',
      'code', 'AUTH_REQUIRED',
      'error_code', 'AUTH_REQUIRED',
      'retryable', false,
      'terminal', true,
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
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
      'error', 'session_not_found',
      'reason', 'session_not_found',
      'code', 'SESSION_NOT_FOUND',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'reason', 'not_participant',
      'code', 'ACCESS_DENIED',
      'error_code', 'ACCESS_DENIED',
      'retryable', false,
      'terminal', true,
      'event_cleanup_prechecked', true,
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');
  v_partner_id := CASE
    WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  IF v_ready_gate_status = 'queued' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'error', 'ready_gate_not_open',
      'reason', 'ready_gate_not_open',
      'code', 'READY_GATE_NOT_OPEN',
      'error_code', 'READY_GATE_NOT_OPEN',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF v_ready_gate_status = 'snoozed'
     AND v_session.snoozed_by IS NOT NULL
     AND v_session.snoozed_by <> v_actor THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at,
      'error', 'partner_snoozed',
      'reason', 'partner_snoozed',
      'code', 'PARTNER_SNOOZED',
      'error_code', 'PARTNER_SNOOZED',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_is_blocked := COALESCE(
      public.is_blocked(v_session.participant_1_id, v_session.participant_2_id),
      false
    );

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
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'error', 'safety_check_unavailable',
        'reason', 'safety_check_unavailable',
        'code', 'SAFETY_CHECK_UNAVAILABLE',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'commandStatus', 'rejected',
        'decisive_mark_ready_prechecked', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF v_is_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'error', 'blocked_pair',
      'reason', 'blocked_pair',
      'code', 'BLOCKED_PAIR',
      'error_code', 'BLOCKED_PAIR',
      'ended_reason', 'blocked_pair',
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF v_has_report THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'error', 'reported_pair',
      'reason', 'reported_pair',
      'code', 'REPORTED_PAIR',
      'error_code', 'REPORTED_PAIR',
      'ended_reason', 'reported_pair',
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF COALESCE(v_actor_hidden, false) OR COALESCE(v_partner_hidden, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'error', CASE WHEN v_actor_hidden THEN 'actor_hidden' ELSE 'partner_hidden' END,
      'reason', CASE WHEN v_actor_hidden THEN 'actor_hidden' ELSE 'partner_hidden' END,
      'code', CASE WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END,
      'error_code', CASE WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END,
      'ended_reason', CASE WHEN v_actor_hidden THEN 'actor_hidden' ELSE 'partner_hidden' END,
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_result := public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_success := COALESCE(
    NULLIF(v_result ->> 'success', '')::boolean,
    NULLIF(v_result ->> 'ok', '')::boolean,
    false
  );
  v_ready_gate_status := COALESCE(
    NULLIF(v_result ->> 'ready_gate_status', ''),
    NULLIF(v_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_result ->> 'status', '')
  );

  IF v_success AND v_ready_gate_status = 'both_ready' THEN
    v_protection := public.video_date_protect_both_ready_entry_v1(
      p_session_id,
      v_actor,
      NULL,
      'video_session_mark_ready_v2'
    );

    IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
      v_result := v_result || jsonb_build_object(
        'entry_protection', 'active',
        'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
        'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
        'daily_room_name', v_protection ->> 'daily_room_name',
        'daily_room_url', v_protection ->> 'daily_room_url',
        'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at'
      );
    ELSE
      v_result := v_result || jsonb_build_object(
        'entry_protection', 'failed',
        'entry_protection_code', v_protection ->> 'code'
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant-owned Ready Gate mark-ready wrapper. Locks the session row, rejects queued/non-actionable/safety-invalid ready taps before delegating to the decisive fail-soft base, and preserves both_ready entry protection.';

CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_server_now_ms bigint;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_deadline_at timestamptz;
  v_actor_role text;
  v_partner_id uuid;
  v_ready_gate_status text;
  v_i_am_ready boolean := false;
  v_partner_ready boolean := false;
  v_is_participant boolean := false;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_inactive_reason text := NULL;
  v_can_mark_ready boolean := false;
  v_can_enter_date boolean := false;
  v_terminal boolean := false;
  v_retryable boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_is_participant :=
    v_uid = v_session.participant_1_id
    OR v_uid = v_session.participant_2_id;

  IF NOT v_is_participant THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'error_code', 'NOT_PARTICIPANT',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');
  v_actor_role := CASE
    WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
    WHEN v_uid = v_session.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_partner_id := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  BEGIN
    v_is_blocked := COALESCE(
      public.is_blocked(v_session.participant_1_id, v_session.participant_2_id),
      false
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_uid AND ur.reported_id = v_partner_id)
         OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_uid)
    )
    INTO v_has_report;

    v_actor_hidden := COALESCE(public.is_profile_hidden(v_uid), false);
    v_partner_hidden := COALESCE(public.is_profile_hidden(v_partner_id), false);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'safety_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'safety_check_unavailable',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'can_mark_ready', false,
        'canMarkReady', false,
        'auxiliary_errors', v_auxiliary_errors,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF COALESCE(v_is_blocked, false)
     OR COALESCE(v_has_report, false)
     OR COALESCE(v_actor_hidden, false)
     OR COALESCE(v_partner_hidden, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'viewer_role', v_actor_role,
      'partner_id', v_partner_id,
      'error', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'error_code', CASE
        WHEN v_is_blocked THEN 'BLOCKED_PAIR'
        WHEN v_has_report THEN 'REPORTED_PAIR'
        WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
        ELSE 'PARTNER_NOT_ELIGIBLE'
      END,
      'reason', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'ended_reason', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'can_mark_ready', false,
      'can_enter_date', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'event_active_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      v_inactive_reason := NULL;
  END;

  v_i_am_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_1_at IS NOT NULL
    ELSE v_session.ready_participant_2_at IS NOT NULL
  END;
  v_partner_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_2_at IS NOT NULL
    ELSE v_session.ready_participant_1_at IS NOT NULL
  END;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_deadline_at := COALESCE(
    v_deadline_row_at,
    CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END
  );

  v_terminal :=
    v_session.ended_at IS NOT NULL
    OR v_session.state::text = 'ended'
    OR v_ready_gate_status IN ('expired', 'forfeited', 'cancelled', 'ended');

  v_can_mark_ready :=
    v_inactive_reason IS NULL
    AND v_session.ended_at IS NULL
    AND v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      v_session.ready_gate_expires_at IS NULL
      OR v_session.ready_gate_expires_at > v_now
      OR v_ready_gate_status = 'snoozed'
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snooze_expires_at IS NULL
      OR v_session.snooze_expires_at > v_now
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snoozed_by IS NULL
      OR v_session.snoozed_by = v_uid
    )
    AND NOT COALESCE(v_is_blocked, false)
    AND NOT COALESCE(v_has_report, false)
    AND NOT COALESCE(v_actor_hidden, false)
    AND NOT COALESCE(v_partner_hidden, false);

  v_can_enter_date :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_session.date_started_at IS NOT NULL
      OR v_session.state::text = 'date'
      OR v_ready_gate_status = 'both_ready'
    )
    AND v_session.daily_room_name IS NOT NULL
    AND v_session.daily_room_url IS NOT NULL;

  v_retryable :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_phase IN ('handshake', 'date')
    );

  v_allowed := CASE
    WHEN v_can_mark_ready THEN ARRAY['mark_ready', 'forfeit']::text[]
    WHEN v_can_enter_date THEN ARRAY['enter_date']::text[]
    WHEN v_ready_gate_status = 'both_ready' THEN ARRAY['enter_date']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN
    jsonb_build_object(
      'ok', true,
      'success', true,
      'snapshot', true,
      'source', 'get_video_date_start_snapshot_v1',
      'session_id', v_session.id,
      'sessionId', v_session.id,
      'event_id', v_session.event_id,
      'eventId', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'partnerId', v_partner_id,
      'viewer_id', v_uid,
      'viewerId', v_uid,
      'actor_role', v_actor_role,
      'actorRole', v_actor_role,
      'viewer_role', v_actor_role,
      'viewerRole', v_actor_role,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'state', v_session.state,
      'phase', v_session.phase,
      'normalized_phase', v_phase,
      'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
      'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
      'seq', COALESCE(v_session.session_seq, 0),
      'session_seq', COALESCE(v_session.session_seq, 0)
    )
    || jsonb_build_object(
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at,
      'i_am_ready', v_i_am_ready,
      'iAmReady', v_i_am_ready,
      'partner_ready', v_partner_ready,
      'partnerReady', v_partner_ready,
      'is_both_ready', v_ready_gate_status = 'both_ready',
      'isBothReady', v_ready_gate_status = 'both_ready',
      'handshake_started_at', v_session.handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
    )
    || jsonb_build_object(
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'room', CASE
        WHEN v_session.daily_room_url IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', v_session.daily_room_name,
          'url', v_session.daily_room_url,
          'tokenRequired', true
        )
      END,
      'ended_at', v_session.ended_at,
      'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END,
      'ended_reason', v_session.ended_reason,
      'endedReason', v_session.ended_reason,
      'inactive_reason', v_inactive_reason,
      'inactiveReason', v_inactive_reason
    )
    || jsonb_build_object(
      'can_mark_ready', v_can_mark_ready,
      'canMarkReady', v_can_mark_ready,
      'can_enter_date', v_can_enter_date,
      'canEnterDate', v_can_enter_date,
      'terminal', v_terminal,
      'retryable', v_retryable,
      'allowedActions', to_jsonb(v_allowed),
      'auxiliary_errors', v_auxiliary_errors,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms,
      'serverNow', v_server_now_ms
    );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'start_snapshot_failed',
      'error_code', 'START_SNAPSHOT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) IS
  'Authoritative Video Date start snapshot. Queued sessions are retryable but not mark-ready actionable; partner-snoozed and safety-invalid pairs cannot advertise mark_ready.';

COMMIT;
