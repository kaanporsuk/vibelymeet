-- Video Date both_ready definitive owner / eligibility closure.
--
-- Applied migration history is immutable. This follow-up keeps existing
-- web/native/mobile callers on the same public RPCs while strengthening the
-- server truth those RPCs return:
--   - canonical participant eligibility now includes active suspension ledger,
--     auth deletion/ban, hidden/paused/suspended profile truth, and age gates;
--   - ready/actionability payloads explicitly separate Ready Gate completion,
--     Ready Gate terminal status, Date terminal status, and next route surface;
--   - the second ready commit sends a fail-soft date_starting notification to
--     both participants, pointing to /date/:sessionId;
--   - service-only diagnostics surface stuck both_ready/provider/survey states.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_participant_eligibility_v1(
  p_profile_id uuid,
  p_source text DEFAULT 'video_date_participant_eligibility_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_participant_eligibility_v1');
  v_profile record;
  v_auth record;
  v_hidden boolean := false;
  v_active_suspension boolean := false;
  v_underage boolean := false;
  v_reason text := NULL;
  v_message text;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PROFILE_NOT_FOUND',
      'error_code', 'PROFILE_NOT_FOUND',
      'reason', 'profile_not_found',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  SELECT
    p.id,
    p.age,
    p.birth_date
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'profile_id', p_profile_id,
      'code', 'PROFILE_NOT_FOUND',
      'error_code', 'PROFILE_NOT_FOUND',
      'reason', 'profile_not_found',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  SELECT
    au.id,
    au.deleted_at,
    au.banned_until
  INTO v_auth
  FROM auth.users au
  WHERE au.id = p_profile_id;

  IF NOT FOUND THEN
    v_reason := 'auth_user_missing';
  ELSIF v_auth.deleted_at IS NOT NULL THEN
    v_reason := 'auth_user_deleted';
  ELSIF v_auth.banned_until IS NOT NULL AND v_auth.banned_until > now() THEN
    v_reason := 'auth_user_banned';
  END IF;

  IF v_reason IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_suspensions us
      WHERE us.user_id = p_profile_id
        AND us.status = 'active'
        AND us.lifted_at IS NULL
        AND (us.expires_at IS NULL OR us.expires_at > now())
    )
    INTO v_active_suspension;

    IF v_active_suspension THEN
      v_reason := 'active_suspension';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    v_hidden := COALESCE(public.is_profile_hidden(p_profile_id), false);
    IF v_hidden THEN
      v_reason := 'profile_hidden';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    v_underage :=
      (v_profile.birth_date IS NOT NULL AND v_profile.birth_date > (current_date - interval '18 years')::date)
      OR (v_profile.birth_date IS NULL AND v_profile.age IS NOT NULL AND v_profile.age < 18);
    IF v_underage THEN
      v_reason := 'underage_profile';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'profile_id', p_profile_id,
      'code', CASE v_reason
        WHEN 'auth_user_missing' THEN 'AUTH_USER_MISSING'
        WHEN 'auth_user_deleted' THEN 'AUTH_USER_DELETED'
        WHEN 'auth_user_banned' THEN 'AUTH_USER_BANNED'
        WHEN 'active_suspension' THEN 'ACTIVE_SUSPENSION'
        WHEN 'profile_hidden' THEN 'PROFILE_HIDDEN'
        WHEN 'underage_profile' THEN 'UNDERAGE_PROFILE'
        ELSE 'PARTICIPANT_NOT_ELIGIBLE'
      END,
      'error_code', CASE v_reason
        WHEN 'auth_user_missing' THEN 'AUTH_USER_MISSING'
        WHEN 'auth_user_deleted' THEN 'AUTH_USER_DELETED'
        WHEN 'auth_user_banned' THEN 'AUTH_USER_BANNED'
        WHEN 'active_suspension' THEN 'ACTIVE_SUSPENSION'
        WHEN 'profile_hidden' THEN 'PROFILE_HIDDEN'
        WHEN 'underage_profile' THEN 'UNDERAGE_PROFILE'
        ELSE 'PARTICIPANT_NOT_ELIGIBLE'
      END,
      'reason', v_reason,
      'retryable', false,
      'terminal', true,
      'source', v_source,
      'active_suspension', v_active_suspension,
      'profile_hidden', v_hidden,
      'underage_profile', v_underage
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'eligible', true,
    'profile_id', p_profile_id,
    'source', v_source,
    'active_suspension', false,
    'profile_hidden', false,
    'underage_profile', false
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'profile_id', p_profile_id,
      'code', 'ELIGIBILITY_CHECK_UNAVAILABLE',
      'error_code', 'ELIGIBILITY_CHECK_UNAVAILABLE',
      'reason', 'eligibility_check_unavailable',
      'retryable', true,
      'terminal', false,
      'source', v_source,
      'sqlstate', SQLSTATE,
      'message', v_message
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_both_ready_route_payload_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'video_date_both_ready_route_payload_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_session record;
  v_status text;
  v_ended boolean := false;
  v_has_provider_room boolean := false;
  v_date_owned boolean := false;
  v_ready_gate_completed boolean := false;
  v_ready_gate_terminal boolean := false;
  v_date_terminal boolean := false;
  v_survey_required boolean := false;
  v_route_decision text := 'stay_lobby';
  v_next_action text := 'lobby';
  v_path text := NULL;
  v_actor_registration_status text := NULL;
  v_actor_feedback_exists boolean := false;
BEGIN
  SELECT
    vs.id,
    vs.event_id,
    vs.participant_1_id,
    vs.participant_2_id,
    vs.state,
    vs.phase,
    vs.ready_gate_status,
    vs.ready_gate_expires_at,
    vs.daily_room_name,
    vs.daily_room_url,
    vs.handshake_started_at,
    vs.date_started_at,
    vs.participant_1_joined_at,
    vs.participant_2_joined_at,
    vs.participant_1_remote_seen_at,
    vs.participant_2_remote_seen_at,
    vs.ended_at,
    vs.ended_reason
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id;

  IF NOT FOUND THEN
    RETURN v_payload || jsonb_build_object(
      'route_decision', 'stay_lobby',
      'routeDecision', 'stay_lobby',
      'next_surface', jsonb_build_object('action', 'lobby'),
      'nextSurface', jsonb_build_object('action', 'lobby'),
      'ready_gate_completed', false,
      'readyGateCompleted', false,
      'ready_gate_terminal', false,
      'readyGateTerminal', false,
      'date_terminal', false,
      'dateTerminal', false,
      'date_owned', false,
      'dateOwned', false,
      'both_ready_date_owned', false,
      'bothReadyDateOwned', false,
      'route_payload_source', p_source
    );
  END IF;

  v_status := COALESCE(v_session.ready_gate_status, v_payload->>'ready_gate_status', v_payload->>'status');
  v_ended := v_session.ended_at IS NOT NULL
    OR v_session.state = 'ended'::public.video_date_state
    OR COALESCE(v_session.phase, '') = 'ended'
    OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended');
  v_has_provider_room := v_session.daily_room_name IS NOT NULL AND v_session.daily_room_url IS NOT NULL;
  v_ready_gate_completed := v_status = 'both_ready';
  v_ready_gate_terminal := v_status IN ('expired', 'forfeited', 'cancelled', 'ended');
  v_date_terminal := v_ended AND (
    v_session.date_started_at IS NOT NULL
    OR v_session.participant_1_remote_seen_at IS NOT NULL
    OR v_session.participant_2_remote_seen_at IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
  );
  v_date_owned := NOT v_ended AND (
    v_status = 'both_ready'
    OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
    OR v_session.handshake_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
  );

  IF p_actor_id IS NOT NULL THEN
    SELECT er.queue_status
    INTO v_actor_registration_status
    FROM public.event_registrations er
    WHERE er.event_id = v_session.event_id
      AND er.profile_id = p_actor_id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = p_session_id
        AND df.user_id = p_actor_id
    )
    INTO v_actor_feedback_exists;
  END IF;

  v_survey_required :=
    COALESCE(v_actor_registration_status, '') = 'in_survey'
    AND NOT COALESCE(v_actor_feedback_exists, false);

  IF v_survey_required THEN
    v_route_decision := 'navigate_survey';
    v_next_action := 'survey';
  ELSIF v_date_owned THEN
    v_route_decision := 'navigate_date';
    v_next_action := 'date';
  ELSIF v_ended THEN
    v_route_decision := 'ended';
    v_next_action := 'lobby';
  ELSIF v_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
        AND v_session.ready_gate_expires_at IS NOT NULL
        AND v_session.ready_gate_expires_at > now() THEN
    v_route_decision := 'navigate_ready';
    v_next_action := 'ready_gate';
  ELSE
    v_route_decision := 'stay_lobby';
    v_next_action := 'lobby';
  END IF;

  v_path := CASE v_next_action
    WHEN 'date' THEN '/date/' || p_session_id::text
    WHEN 'survey' THEN '/date/' || p_session_id::text
    WHEN 'ready_gate' THEN '/ready/' || p_session_id::text
    WHEN 'lobby' THEN '/event/' || v_session.event_id::text || '/lobby'
    ELSE NULL
  END;

  RETURN v_payload || jsonb_build_object(
    'route_decision', v_route_decision,
    'routeDecision', v_route_decision,
    'next_surface', jsonb_strip_nulls(jsonb_build_object(
      'action', v_next_action,
      'path', v_path,
      'session_id', p_session_id,
      'event_id', v_session.event_id
    )),
    'nextSurface', jsonb_strip_nulls(jsonb_build_object(
      'action', v_next_action,
      'path', v_path,
      'sessionId', p_session_id,
      'eventId', v_session.event_id
    )),
    'ready_gate_completed', v_ready_gate_completed,
    'readyGateCompleted', v_ready_gate_completed,
    'ready_gate_terminal', v_ready_gate_terminal,
    'readyGateTerminal', v_ready_gate_terminal,
    'date_terminal', v_date_terminal,
    'dateTerminal', v_date_terminal,
    'date_owned', v_date_owned,
    'dateOwned', v_date_owned,
    'both_ready_date_owned', v_ready_gate_completed AND NOT v_ended,
    'bothReadyDateOwned', v_ready_gate_completed AND NOT v_ended,
    'provider_room_present', v_has_provider_room,
    'providerRoomPresent', v_has_provider_room,
    'canonical_daily_room_name', v_session.daily_room_name,
    'canonicalDailyRoomName', v_session.daily_room_name,
    'canonical_daily_room_url', v_session.daily_room_url,
    'canonicalDailyRoomUrl', v_session.daily_room_url,
    'route_payload_source', p_source
  );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_ready_gate_actionability_owner_eligibility_base(uuid, uuid, text, boolean, boolean, boolean, boolean)') IS NULL
     AND to_regprocedure('public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_ready_gate_actionability_v1(
      uuid, uuid, text, boolean, boolean, boolean, boolean
    ) RENAME TO vd_ready_gate_actionability_owner_eligibility_base;
  END IF;

  IF to_regprocedure('public.vd_mark_ready_both_ready_owner_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO vd_mark_ready_both_ready_owner_base;
  END IF;

  IF to_regprocedure('public.vd_start_snapshot_both_ready_owner_base(uuid)') IS NULL
     AND to_regprocedure('public.get_video_date_start_snapshot_v1(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.get_video_date_start_snapshot_v1(uuid)
      RENAME TO vd_start_snapshot_both_ready_owner_base;
  END IF;

  IF to_regprocedure('public.vd_transition_both_ready_owner_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO vd_transition_both_ready_owner_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_ready_gate_actionability_owner_eligibility_base(
  uuid, uuid, text, boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_ready_gate_actionability_owner_eligibility_base(
  uuid, uuid, text, boolean, boolean, boolean, boolean
) TO service_role;

REVOKE ALL ON FUNCTION public.vd_mark_ready_both_ready_owner_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_mark_ready_both_ready_owner_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_start_snapshot_both_ready_owner_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_start_snapshot_both_ready_owner_base(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_transition_both_ready_owner_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_transition_both_ready_owner_base(uuid, text, text)
  TO service_role;

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
  v_actor_ok boolean := true;
  v_partner_ok boolean := true;
  v_invalid_role text := NULL;
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
    IF p_terminalize_invalid THEN
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
        'code', CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END,
        'error_code', CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END,
        'error', CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END,
        'reason', CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END,
        'retryable', lower(COALESCE(
          CASE WHEN v_invalid_role = 'actor' THEN v_actor_eligibility ->> 'retryable' ELSE v_partner_eligibility ->> 'retryable' END,
          'false'
        )) IN ('true', 't', '1', 'yes'),
        'terminal', true,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
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

  v_success := lower(COALESCE(v_result ->> 'success', v_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
  v_status := COALESCE(
    NULLIF(v_result ->> 'ready_gate_status', ''),
    NULLIF(v_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_result ->> 'status', '')
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
    COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'date_starting_notification_degraded', v_date_starting_degraded,
      'both_ready_route_owner_checked', true
    ),
    'video_session_mark_ready_v2.both_ready_owner'
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
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.vd_start_snapshot_both_ready_owner_base(p_session_id);
  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'both_ready_route_owner_checked', true
    ),
    'get_video_date_start_snapshot_v1.both_ready_owner'
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
      'get_video_date_start_snapshot_v1.both_ready_owner',
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
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.vd_transition_both_ready_owner_base(
    p_session_id,
    p_action,
    p_reason
  );

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'both_ready_route_owner_checked', lower(COALESCE(NULLIF(btrim(p_action), ''), '')) = 'prepare_entry'
    ),
    'video_date_transition.both_ready_owner'
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
      'video_date_transition.both_ready_owner',
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

CREATE OR REPLACE FUNCTION public.video_date_both_ready_operator_diagnostics_v1(
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
  v_daily_domain text := COALESCE(NULLIF(btrim(current_setting('app.daily_domain', true)), ''), 'vibelyapp.daily.co');
  v_rows jsonb;
BEGIN
  WITH candidate AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.state,
      vs.phase,
      vs.daily_room_name,
      vs.daily_room_url,
      vs.handshake_started_at,
      vs.date_started_at,
      vs.participant_1_joined_at,
      vs.participant_2_joined_at,
      vs.participant_1_remote_seen_at,
      vs.participant_2_remote_seen_at,
      vs.ended_at,
      vs.ended_reason,
      vs.state_updated_at,
      vs.ready_gate_expires_at,
      COALESCE(df.feedback_count, 0) AS feedback_count,
      CASE
        WHEN vs.ready_gate_status = 'both_ready'
             AND vs.ended_at IS NULL
             AND (vs.participant_1_joined_at IS NULL OR vs.participant_2_joined_at IS NULL)
          THEN 'both_ready_without_bilateral_join'
        WHEN vs.daily_room_url IS NOT NULL
             AND vs.daily_room_url NOT LIKE ('https://' || v_daily_domain || '/%')
          THEN 'daily_room_domain_mismatch'
        WHEN vs.participant_1_joined_at IS NOT NULL
             AND vs.participant_2_joined_at IS NOT NULL
             AND (vs.participant_1_remote_seen_at IS NULL OR vs.participant_2_remote_seen_at IS NULL)
             AND vs.ended_at IS NULL
          THEN 'joined_without_bilateral_remote_seen'
        WHEN vs.participant_1_remote_seen_at IS NOT NULL
             AND vs.participant_2_remote_seen_at IS NOT NULL
             AND vs.date_started_at IS NULL
             AND vs.ended_at IS NULL
          THEN 'remote_seen_without_date_promotion'
        WHEN vs.ended_at IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.event_registrations er
               WHERE er.event_id = vs.event_id
                 AND er.current_room_id = vs.id
                 AND er.queue_status = 'in_survey'
             )
             AND COALESCE(df.feedback_count, 0) < 2
          THEN 'survey_required_without_bilateral_feedback'
        ELSE NULL
      END AS diagnostic_category
    FROM public.video_sessions vs
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS feedback_count
      FROM public.date_feedback df
      WHERE df.session_id = vs.id
    ) df ON true
    WHERE (p_event_id IS NULL OR vs.event_id = p_event_id)
      AND (
        vs.ready_gate_status = 'both_ready'
        OR vs.handshake_started_at IS NOT NULL
        OR vs.date_started_at IS NOT NULL
        OR vs.ended_at IS NOT NULL
        OR vs.daily_room_url IS NOT NULL
      )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(candidate) ORDER BY state_updated_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM candidate
    WHERE diagnostic_category IS NOT NULL
    ORDER BY state_updated_at DESC NULLS LAST
    LIMIT v_limit
  ) candidate;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'event_id', p_event_id,
    'daily_domain', v_daily_domain,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'generated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_participant_eligibility_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_participant_eligibility_v1(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_both_ready_route_payload_v1(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_both_ready_route_payload_v1(uuid, uuid, jsonb, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_ready_gate_actionability_v1(
  uuid, uuid, text, boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_ready_gate_actionability_v1(
  uuid, uuid, text, boolean, boolean, boolean, boolean
) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.video_date_both_ready_operator_diagnostics_v1(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_both_ready_operator_diagnostics_v1(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.video_date_participant_eligibility_v1(uuid, text) IS
  'Canonical Video Date participant eligibility check for Ready/date entry: auth deletion/ban, suspension ledger, hidden/paused/suspended profile truth, and age gates.';
COMMENT ON FUNCTION public.video_date_both_ready_route_payload_v1(uuid, uuid, jsonb, text) IS
  'Adds explicit route ownership, next surface, Ready Gate completion, Ready Gate terminal, Date terminal, and canonical Daily room fields to Video Date RPC payloads.';
COMMENT ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean) IS
  'Ready Gate actionability wrapper with canonical participant eligibility and explicit both_ready/date-owner route payload fields.';
COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant Ready Gate mark-ready RPC with eligibility-gated actionability, fail-soft date_starting notification on both_ready, and explicit route-owner payload fields.';
COMMENT ON FUNCTION public.video_date_both_ready_operator_diagnostics_v1(uuid, integer) IS
  'Service-only diagnostics for stuck both_ready, provider room domain mismatch, join/remote-seen/promotion lag, and survey feedback gaps.';

NOTIFY pgrst, 'reload schema';

COMMIT;
