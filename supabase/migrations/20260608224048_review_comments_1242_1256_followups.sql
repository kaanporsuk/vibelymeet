-- Review-comment follow-ups for PR #1242 through PR #1256.
--
-- Applied migrations are immutable. This corrective migration replaces current
-- public wrapper bodies and invariant helpers without editing applied history.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_post_date_zero_feedback_reminders_v1(
  p_older_than interval DEFAULT interval '5 minutes',
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH eligible_roles AS (
    SELECT
      vs.id AS session_id,
      vs.event_id,
      vs.ended_at,
      er.id AS registration_id,
      er.queue_status,
      'participant_1'::text AS participant_role,
      vs.participant_1_id AS missing_user_id,
      vs.participant_2_id AS partner_user_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_1_id
     AND er.current_room_id = vs.id
    WHERE vs.ended_at IS NOT NULL
      AND er.queue_status = 'in_survey'
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
      AND vs.ended_at <= now() - COALESCE(p_older_than, interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df_any
        WHERE df_any.session_id = vs.id
      )

    UNION ALL

    SELECT
      vs.id,
      vs.event_id,
      vs.ended_at,
      er.id,
      er.queue_status,
      'participant_2'::text,
      vs.participant_2_id,
      vs.participant_1_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_2_id
     AND er.current_room_id = vs.id
    WHERE vs.ended_at IS NOT NULL
      AND er.queue_status = 'in_survey'
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
      AND vs.ended_at <= now() - COALESCE(p_older_than, interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df_any
        WHERE df_any.session_id = vs.id
      )
  ),
  limited_roles AS (
    SELECT er.*
    FROM eligible_roles er
    WHERE NOT public.is_blocked(er.missing_user_id, er.partner_user_id)
      AND NOT public.is_blocked(er.partner_user_id, er.missing_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = er.missing_user_id AND ur.reported_id = er.partner_user_id)
           OR (ur.reporter_id = er.partner_user_id AND ur.reported_id = er.missing_user_id)
      )
    ORDER BY er.ended_at, er.session_id, er.participant_role
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 1000))
  ),
  upserted AS (
    INSERT INTO public.post_date_zero_feedback_reminders (
      session_id,
      event_id,
      missing_user_id,
      registration_id,
      participant_role,
      queue_status,
      first_detected_at,
      last_seen_at,
      reminder_eligible_at,
      status,
      created_at,
      updated_at
    )
    SELECT
      lr.session_id,
      lr.event_id,
      lr.missing_user_id,
      lr.registration_id,
      lr.participant_role,
      lr.queue_status,
      lr.ended_at,
      now(),
      GREATEST(lr.ended_at + COALESCE(p_older_than, interval '5 minutes'), now()),
      'pending',
      now(),
      now()
    FROM limited_roles lr
    ON CONFLICT (session_id, missing_user_id) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      registration_id = EXCLUDED.registration_id,
      participant_role = EXCLUDED.participant_role,
      queue_status = EXCLUDED.queue_status,
      last_seen_at = now(),
      reminder_eligible_at = CASE
        WHEN public.post_date_zero_feedback_reminders.reminder_sent_at IS NULL
          THEN LEAST(public.post_date_zero_feedback_reminders.reminder_eligible_at, EXCLUDED.reminder_eligible_at)
        ELSE public.post_date_zero_feedback_reminders.reminder_eligible_at
      END,
      completed_at = NULL,
      status = CASE
        WHEN public.post_date_zero_feedback_reminders.stale_at IS NOT NULL THEN 'stale'
        WHEN public.post_date_zero_feedback_reminders.reminder_sent_at IS NOT NULL THEN 'reminded'
        ELSE 'pending'
      END,
      updated_at = now()
    RETURNING 1
  ),
  completed AS (
    UPDATE public.post_date_zero_feedback_reminders zr
    SET
      completed_at = COALESCE(zr.completed_at, now()),
      status = 'completed',
      updated_at = now()
    WHERE zr.completed_at IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.date_feedback df
          WHERE df.session_id = zr.session_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM public.video_sessions vs
          JOIN public.event_registrations er
            ON er.event_id = vs.event_id
           AND er.profile_id = zr.missing_user_id
           AND er.current_room_id = vs.id
          WHERE vs.id = zr.session_id
            AND er.queue_status = 'in_survey'
            AND public.video_date_session_is_post_date_survey_eligible_v2(
              vs.ended_at,
              vs.ended_reason,
              vs.date_started_at,
              vs.state::text,
              vs.phase,
              vs.participant_1_joined_at,
              vs.participant_2_joined_at,
              vs.participant_1_remote_seen_at,
              vs.participant_2_remote_seen_at
            )
        )
      )
    RETURNING 1
  )
  SELECT COALESCE((SELECT count(*) FROM upserted), 0)::integer
  INTO v_count;

  RETURN v_count;
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
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_ready_gate_actionability_v1');
  v_actor uuid := p_actor_id;
  v_base jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_partner_id uuid;
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
  v_terminalize jsonb;
  v_message text;
BEGIN
  v_base := public.vd_ready_gate_actionability_owner_eligibility_base(
    p_session_id,
    p_actor_id,
    v_source,
    p_allow_actor_owned_snooze,
    p_require_current_ready_gate_registration,
    p_terminalize_invalid,
    p_lock_rows
  );

  IF lower(COALESCE(v_base ->> 'ok', v_base ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
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

  IF NOT FOUND
     OR v_actor IS NULL
     OR (v_session.participant_1_id IS DISTINCT FROM v_actor AND v_session.participant_2_id IS DISTINCT FROM v_actor) THEN
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

  v_partner_id := CASE
    WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

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
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
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
        'source', v_source,
        'sqlstate', SQLSTATE,
        'message', v_message
      ),
      v_source
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(
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
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_owner_id text := NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), '');
  v_call_instance_id text := NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), '');
  v_entry_attempt_id text := NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), '');
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_latest_alive_owner_id text;
  v_latest_alive_call_instance_id text;
  v_latest_alive_provider_session_id text;
  v_latest_alive_at timestamptz;
  v_provider_backed_current boolean := false;
  v_owner_call_current boolean := false;
  v_retryable boolean := false;
  v_rejection_code text := 'REMOTE_SEEN_PROVIDER_NOT_CURRENT';
  v_result jsonb;
  v_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'unauthorized',
      'code', 'UNAUTHORIZED',
      'retryable', false
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_found',
      'code', 'NOT_FOUND',
      'retryable', false
    );
  END IF;

  IF v_actor IS DISTINCT FROM v_row.participant_1_id
     AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'forbidden',
      'code', 'FORBIDDEN',
      'retryable', false
    );
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_ended',
      'code', 'SESSION_ENDED',
      'retryable', false,
      'terminal', true,
      'session_ended', true,
      'ended_at', v_row.ended_at,
      'ended_reason', v_row.ended_reason,
      'provider_session_id', v_provider_session_id,
      'owner_state', v_owner_state
    );
    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
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
    AND vde.provider_user_id = v_actor::text
    AND vde.event_type IN ('participant.joined', 'participant.left')
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  SELECT
    vpe.owner_id,
    vpe.call_instance_id,
    vpe.provider_session_id,
    vpe.occurred_at
  INTO
    v_latest_alive_owner_id,
    v_latest_alive_call_instance_id,
    v_latest_alive_provider_session_id,
    v_latest_alive_at
  FROM public.video_date_presence_events vpe
  WHERE vpe.session_id = p_session_id
    AND vpe.actor_id = v_actor
    AND vpe.event_type = 'client_daily_alive'
    AND vpe.owner_state = 'joined'
  ORDER BY vpe.occurred_at DESC NULLS LAST, vpe.created_at DESC
  LIMIT 1;

  v_owner_call_current := COALESCE(
    v_owner_id IS NOT NULL
    AND v_call_instance_id IS NOT NULL
    AND v_latest_alive_owner_id = v_owner_id
    AND v_latest_alive_call_instance_id = v_call_instance_id
    AND v_latest_alive_provider_session_id = v_provider_session_id
    AND v_latest_alive_at >= now() - interval '15 seconds',
    false
  );

  v_provider_backed_current := COALESCE(
    v_owner_state = 'joined'
    AND v_provider_session_id IS NOT NULL
    AND v_latest_provider_event_type = 'participant.joined'
    AND v_latest_provider_session_id = v_provider_session_id
    AND v_owner_call_current,
    false
  );

  IF v_provider_backed_current IS NOT TRUE THEN
    v_retryable := COALESCE(
      v_provider_session_id IS NOT NULL
      AND v_owner_state = 'joined'
      AND v_owner_id IS NOT NULL
      AND v_call_instance_id IS NOT NULL
      AND (
        v_latest_provider_event_type IS NULL
        OR (
          v_latest_provider_event_type = 'participant.left'
          AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
        )
        OR v_latest_alive_at IS NULL
        OR v_latest_alive_at < now() - interval '15 seconds'
      ),
      false
    );

    v_rejection_code := CASE
      WHEN v_owner_id IS NULL THEN 'REMOTE_SEEN_OWNER_MISSING'
      WHEN v_call_instance_id IS NULL THEN 'REMOTE_SEEN_CALL_INSTANCE_MISSING'
      WHEN v_provider_session_id IS NULL THEN 'REMOTE_SEEN_PROVIDER_SESSION_MISSING'
      WHEN v_owner_state IS DISTINCT FROM 'joined' THEN 'REMOTE_SEEN_OWNER_NOT_JOINED'
      WHEN v_latest_provider_event_type = 'participant.left'
           AND v_latest_provider_session_id = v_provider_session_id
        THEN 'REMOTE_SEEN_PROVIDER_SESSION_LEFT'
      WHEN v_latest_alive_at IS NULL THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_MISSING'
      WHEN v_latest_alive_at < now() - interval '15 seconds' THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_STALE'
      WHEN v_latest_alive_owner_id IS DISTINCT FROM v_owner_id THEN 'REMOTE_SEEN_OWNER_MISMATCH'
      WHEN v_latest_alive_call_instance_id IS DISTINCT FROM v_call_instance_id THEN 'REMOTE_SEEN_CALL_INSTANCE_MISMATCH'
      WHEN v_latest_alive_provider_session_id IS DISTINCT FROM v_provider_session_id THEN 'REMOTE_SEEN_OWNER_PROVIDER_MISMATCH'
      ELSE 'REMOTE_SEEN_PROVIDER_NOT_CURRENT'
    END;

    BEGIN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'remote_seen_rejected_stale_provider_session',
        NULL,
        v_row.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_remote_seen',
          'owner_id', v_owner_id,
          'call_instance_id', v_call_instance_id,
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', v_entry_attempt_id,
          'owner_state', v_owner_state,
          'provider_presence_required', true,
          'owner_call_presence_required', true,
          'provider_backed_current', false,
          'owner_call_current', v_owner_call_current,
          'latest_provider_event_type', v_latest_provider_event_type,
          'latest_provider_event_at', v_latest_provider_event_at,
          'latest_provider_session_id', v_latest_provider_session_id,
          'latest_alive_owner_id', v_latest_alive_owner_id,
          'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
          'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
          'latest_alive_at', v_latest_alive_at,
          'join_stamp_accepted', false,
          'remote_seen_stamp_accepted', false,
          'rejection_code', v_rejection_code,
          'retryable', v_retryable
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    v_payload := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', lower(v_rejection_code),
      'code', v_rejection_code,
      'error_code', v_rejection_code,
      'retryable', v_retryable,
      'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
      'provider_presence_required', true,
      'owner_call_presence_required', true,
      'provider_presence_missing', true,
      'provider_presence_terminal',
        v_latest_provider_event_type = 'participant.left'
        AND v_latest_provider_session_id = v_provider_session_id,
      'provider_backed_current', false,
      'owner_call_current', v_owner_call_current,
      'join_stamp_accepted', false,
      'remote_seen_stamp_accepted', false,
      'remote_seen_rejected_stale_provider_session', true,
      'owner_id', v_owner_id,
      'call_instance_id', v_call_instance_id,
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', v_entry_attempt_id,
      'owner_state', v_owner_state,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id,
      'latest_alive_owner_id', v_latest_alive_owner_id,
      'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
      'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
      'latest_alive_at', v_latest_alive_at
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    );
  END IF;

  v_result := public.mark_video_date_remote_seen_20260608120000_provider_base(p_session_id);

  v_payload := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'provider_presence_required', true,
    'owner_call_presence_required', true,
    'provider_backed_current', true,
    'owner_call_current', true,
    'provider_presence_missing', false,
    'provider_presence_terminal', false,
    'remote_seen_stamp_accepted', true,
    'owner_id', v_owner_id,
    'call_instance_id', v_call_instance_id,
    'provider_session_id', v_provider_session_id,
    'entry_attempt_id', v_entry_attempt_id,
    'owner_state', v_owner_state,
    'latest_provider_event_type', v_latest_provider_event_type,
    'latest_provider_event_at', v_latest_provider_event_at,
    'latest_provider_session_id', v_latest_provider_session_id,
    'latest_alive_owner_id', v_latest_alive_owner_id,
    'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
    'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
    'latest_alive_at', v_latest_alive_at
  );

  RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
    p_session_id,
    v_actor,
    'mark_video_date_remote_seen',
    v_payload
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
        'mark_video_date_remote_seen',
        'remote_seen_stamp_failed',
        'REMOTE_SEEN_STAMP_FAILED',
        true,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        RETURN jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'remote_seen_stamp_failed',
          'code', 'REMOTE_SEEN_STAMP_FAILED',
          'error_code', 'REMOTE_SEEN_STAMP_FAILED',
          'rpc', 'mark_video_date_remote_seen',
          'retryable', true,
          'retry_after_ms', 1500,
          'session_id', p_session_id,
          'actor_id', v_actor,
          'provider_session_id', v_provider_session_id,
          'owner_state', v_owner_state,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms,
          'direct_json_fallback', true
        );
    END;
END;
$function$;

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
  v_actor uuid := NULL;
  v_result jsonb;
  v_clean_result jsonb;
  v_success boolean := false;
  v_status text;
  v_session public.video_sessions%ROWTYPE;
  v_date_starting_degraded boolean := false;
  v_recipient uuid;
  v_enqueue_result jsonb;
  v_path text;
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

  BEGIN
    v_result := public.vd_mark_ready_both_ready_owner_base(
      p_session_id,
      p_idempotency_key,
      p_request_hash
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'video_session_mark_ready_v2.both_ready_owner',
        'mark_ready_unavailable',
        'MARK_READY_UNAVAILABLE',
        true,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
  END;

  v_clean_result := COALESCE(v_result, '{}'::jsonb);
  IF COALESCE(v_clean_result ->> 'code', v_clean_result ->> 'error_code') = 'SAFETY_CHECK_UNAVAILABLE' THEN
    v_clean_result := v_clean_result
      - 'sqlstate'
      - 'message'
      - 'detail'
      - 'hint'
      - 'context'
      - 'auxiliary_errors';
  END IF;

  v_success := lower(COALESCE(v_clean_result ->> 'success', v_clean_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
  v_status := COALESCE(
    NULLIF(v_clean_result ->> 'ready_gate_status', ''),
    NULLIF(v_clean_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_clean_result ->> 'status', '')
  );

  IF v_success AND v_status = 'both_ready' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_path := '/date/' || p_session_id::text;
      FOREACH v_recipient IN ARRAY ARRAY[v_session.participant_1_id, v_session.participant_2_id]
      LOOP
        BEGIN
          v_enqueue_result := public.video_date_outbox_enqueue_v2(
            p_session_id,
            'notification.send',
            jsonb_build_object(
              'user_id', v_recipient,
              'recipient_id', v_recipient,
              'match_user_id', CASE
                WHEN v_recipient = v_session.participant_1_id THEN v_session.participant_2_id
                ELSE v_session.participant_1_id
              END,
              'category', 'date_starting',
              'title', 'Your video date is starting',
              'body', 'Tap to join your video date',
              'data', jsonb_build_object(
                'session_id', p_session_id,
                'event_id', v_session.event_id,
                'ready_gate_status', v_status,
                'actor_id', v_actor,
                'url', v_path,
                'deep_link', v_path,
                'source', 'video_session_mark_ready_v2_both_ready'
              ),
              'dedupe_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
              'provider_idempotency_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
              'source', 'video_session_mark_ready_v2',
              'event_id', v_session.event_id,
              'session_id', p_session_id,
              'actor_id', v_actor
            ),
            'notification:date_starting:' || p_session_id::text || ':' || v_recipient::text,
            now()
          );

          IF lower(COALESCE(v_enqueue_result ->> 'ok', v_enqueue_result ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
            v_date_starting_degraded := true;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            v_date_starting_degraded := true;
        END;
      END LOOP;
    END IF;
  END IF;

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    v_clean_result || jsonb_build_object(
      'date_starting_notification_degraded', v_date_starting_degraded,
      'both_ready_route_owner_checked', true
    ),
    'video_session_mark_ready_v2.both_ready_owner'
  );
END;
$function$;

COMMENT ON FUNCTION public.sync_post_date_zero_feedback_reminders_v1(interval, integer) IS
  'Syncs zero-feedback survey reminders only for active in_survey registration rows whose current_room_id still owns the ended Video Date session.';

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text) IS
  'Marks remote-media evidence only when the actor still has current provider proof plus matching server-recorded Daily owner/call heartbeat proof.';

COMMENT ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean) IS
  'Ready Gate actionability wrapper with route ownership, eligibility checks, and retryable eligibility failures that do not terminalize valid Ready Gates.';

NOTIFY pgrst, 'reload schema';

COMMIT;
