-- Strict Daily joined proof and render-bound remote-seen truth.
--
-- Keep applied history immutable. This forward migration preserves the public
-- Video Date RPC names used by web/native/mobile clients while tightening the
-- server truth those RPCs require:
--   - Daily joined/alive can only advance after a matching provider joined
--     webhook for the same provider session and no newer same-session leave.
--   - lifecycle RPCs reject ended/inactive/stale-registration/ineligible
--     participants before stamping joined, remote_seen, or promoting to date.
--   - remote_seen requires explicit render/media evidence from the client and
--     then delegates to the existing provider/current-call guard.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_session_lifecycle_eligibility_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_session_lifecycle_eligibility_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := p_actor_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_session_lifecycle_eligibility_v1');
  v_session public.video_sessions%ROWTYPE;
  v_partner_id uuid;
  v_actor_registration public.event_registrations%ROWTYPE;
  v_partner_registration public.event_registrations%ROWTYPE;
  v_actor_eligibility jsonb := '{}'::jsonb;
  v_partner_eligibility jsonb := '{}'::jsonb;
  v_actor_ok boolean := false;
  v_partner_ok boolean := false;
  v_inactive_reason text;
BEGIN
  IF v_actor IS NULL THEN
    BEGIN
      v_actor := auth.uid();
    EXCEPTION
      WHEN OTHERS THEN
        v_actor := NULL;
    END;
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'UNAUTHORIZED',
      'error_code', 'UNAUTHORIZED',
      'error', 'unauthorized',
      'retryable', false,
      'terminal', false,
      'source', v_source
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
      'eligible', false,
      'code', 'SESSION_NOT_FOUND',
      'error_code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'source', v_source
    );
  END IF;

  IF v_actor IS DISTINCT FROM v_session.participant_1_id
     AND v_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'NOT_PARTICIPANT',
      'error_code', 'NOT_PARTICIPANT',
      'error', 'not_participant',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'source', v_source
    );
  END IF;

  v_partner_id := CASE
    WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR COALESCE(v_session.phase, '') = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'SESSION_ENDED',
      'error_code', 'SESSION_ENDED',
      'error', 'session_ended',
      'retryable', false,
      'terminal', true,
      'session_ended', true,
      'session_id', p_session_id,
      'actor_id', v_actor,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'source', v_source
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL
     AND v_session.date_started_at IS NULL
     AND v_session.state::text IS DISTINCT FROM 'date'
     AND COALESCE(v_session.phase, '') IS DISTINCT FROM 'date' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'EVENT_INACTIVE',
      'error_code', 'EVENT_INACTIVE',
      'error', 'event_inactive',
      'reason', v_inactive_reason,
      'inactive_reason', v_inactive_reason,
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'source', v_source
    );
  END IF;

  SELECT *
  INTO v_actor_registration
  FROM public.event_registrations
  WHERE event_id = v_session.event_id
    AND profile_id = v_actor;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_EVENT_REGISTRATION_MISSING',
      'error_code', 'ACTOR_EVENT_REGISTRATION_MISSING',
      'error', 'actor_event_registration_missing',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'source', v_source
    );
  END IF;

  SELECT *
  INTO v_partner_registration
  FROM public.event_registrations
  WHERE event_id = v_session.event_id
    AND profile_id = v_partner_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_EVENT_REGISTRATION_MISSING',
      'error_code', 'PARTNER_EVENT_REGISTRATION_MISSING',
      'error', 'partner_event_registration_missing',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF v_actor_registration.current_room_id IS DISTINCT FROM p_session_id
     OR COALESCE(v_actor_registration.queue_status, '') NOT IN (
       'in_ready_gate',
       'in_handshake',
       'in_date',
       'in_survey'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_SESSION_REGISTRATION_MISMATCH',
      'error_code', 'ACTOR_SESSION_REGISTRATION_MISMATCH',
      'error', 'actor_session_registration_mismatch',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF v_partner_registration.current_room_id IS DISTINCT FROM p_session_id
     OR COALESCE(v_partner_registration.queue_status, '') NOT IN (
       'in_ready_gate',
       'in_handshake',
       'in_date',
       'in_survey'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_SESSION_REGISTRATION_MISMATCH',
      'error_code', 'PARTNER_SESSION_REGISTRATION_MISMATCH',
      'error', 'partner_session_registration_mismatch',
      'retryable', false,
      'terminal', true,
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'partner_queue_status', v_partner_registration.queue_status,
      'partner_current_room_id', v_partner_registration.current_room_id,
      'source', v_source
    );
  END IF;

  v_actor_eligibility := public.video_date_participant_eligibility_v1(
    v_actor,
    v_source || '.actor'
  );
  v_partner_eligibility := public.video_date_participant_eligibility_v1(
    v_partner_id,
    v_source || '.partner'
  );

  v_actor_ok := COALESCE((v_actor_eligibility->>'ok')::boolean, false)
    AND COALESCE((v_actor_eligibility->>'eligible')::boolean, false);
  v_partner_ok := COALESCE((v_partner_eligibility->>'ok')::boolean, false)
    AND COALESCE((v_partner_eligibility->>'eligible')::boolean, false);

  IF NOT v_actor_ok THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'ACTOR_NOT_ELIGIBLE',
      'error_code', 'ACTOR_NOT_ELIGIBLE',
      'error', 'actor_not_eligible',
      'retryable', COALESCE((v_actor_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_actor_eligibility->>'terminal')::boolean, true),
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'actor_eligibility', v_actor_eligibility,
      'actor_queue_status', v_actor_registration.queue_status,
      'actor_current_room_id', v_actor_registration.current_room_id,
      'source', v_source
    );
  END IF;

  IF NOT v_partner_ok THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'eligible', false,
      'code', 'PARTNER_NOT_ELIGIBLE',
      'error_code', 'PARTNER_NOT_ELIGIBLE',
      'error', 'partner_not_eligible',
      'retryable', COALESCE((v_partner_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_partner_eligibility->>'terminal')::boolean, true),
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'actor_id', v_actor,
      'partner_id', v_partner_id,
      'partner_eligibility', v_partner_eligibility,
      'partner_queue_status', v_partner_registration.queue_status,
      'partner_current_room_id', v_partner_registration.current_room_id,
      'source', v_source
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'eligible', true,
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'actor_id', v_actor,
    'partner_id', v_partner_id,
    'actor_queue_status', v_actor_registration.queue_status,
    'actor_current_room_id', v_actor_registration.current_room_id,
    'partner_queue_status', v_partner_registration.queue_status,
    'partner_current_room_id', v_partner_registration.current_room_id,
    'actor_eligibility', v_actor_eligibility,
    'partner_eligibility', v_partner_eligibility,
    'lifecycle_eligibility_checked', true,
    'source', v_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_current_provider_session_proof_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_provider_session_id text,
  p_owner_state text DEFAULT 'joined',
  p_source text DEFAULT 'video_date_current_provider_session_proof_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_current_provider_session_proof_v1');
  v_joined_at timestamptz;
  v_joined_provider_event_id text;
  v_left_at timestamptz;
  v_left_provider_event_id text;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'provider_backed_current', false,
      'provider_presence_required', true,
      'code', 'UNAUTHORIZED',
      'error_code', 'UNAUTHORIZED',
      'error', 'unauthorized',
      'retryable', false,
      'provider_presence_terminal', false,
      'source', v_source
    );
  END IF;

  IF v_owner_state IS DISTINCT FROM 'joined' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'provider_backed_current', false,
      'provider_presence_required', true,
      'code', 'DAILY_JOIN_OWNER_NOT_JOINED',
      'error_code', 'DAILY_JOIN_OWNER_NOT_JOINED',
      'error', 'daily_join_owner_not_joined',
      'retryable', false,
      'provider_presence_terminal', false,
      'owner_state', v_owner_state,
      'source', v_source
    );
  END IF;

  IF v_provider_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'provider_backed_current', false,
      'provider_presence_required', true,
      'code', 'DAILY_JOIN_PROVIDER_SESSION_MISSING',
      'error_code', 'DAILY_JOIN_PROVIDER_SESSION_MISSING',
      'error', 'daily_join_provider_session_missing',
      'retryable', true,
      'retry_after_ms', 1500,
      'provider_presence_terminal', false,
      'owner_state', v_owner_state,
      'source', v_source
    );
  END IF;

  SELECT
    vde.occurred_at,
    vde.provider_event_id
  INTO v_joined_at, v_joined_provider_event_id
  FROM public.video_date_daily_webhook_events vde
  WHERE vde.session_id = p_session_id
    AND vde.provider_user_id = p_actor_id::text
    AND vde.event_type = 'participant.joined'
    AND public.video_date_daily_provider_session_id_from_event_v1(
      vde.provider_participant_id,
      vde.payload
    ) = v_provider_session_id
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  SELECT
    vde.occurred_at,
    vde.provider_event_id
  INTO v_left_at, v_left_provider_event_id
  FROM public.video_date_daily_webhook_events vde
  WHERE vde.session_id = p_session_id
    AND vde.provider_user_id = p_actor_id::text
    AND vde.event_type = 'participant.left'
    AND public.video_date_daily_provider_session_id_from_event_v1(
      vde.provider_participant_id,
      vde.payload
    ) = v_provider_session_id
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  IF v_joined_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'provider_backed_current', false,
      'provider_presence_required', true,
      'provider_presence_missing', true,
      'code', 'DAILY_JOIN_PROVIDER_WEBHOOK_PENDING',
      'error_code', 'DAILY_JOIN_PROVIDER_WEBHOOK_PENDING',
      'error', 'daily_join_provider_webhook_pending',
      'retryable', true,
      'retry_after_ms', 1500,
      'provider_presence_terminal', false,
      'provider_session_id', v_provider_session_id,
      'owner_state', v_owner_state,
      'source', v_source
    );
  END IF;

  IF v_left_at IS NOT NULL AND v_left_at >= v_joined_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'provider_backed_current', false,
      'provider_presence_required', true,
      'provider_presence_missing', true,
      'code', 'DAILY_JOIN_PROVIDER_SESSION_LEFT',
      'error_code', 'DAILY_JOIN_PROVIDER_SESSION_LEFT',
      'error', 'daily_join_provider_session_left',
      'retryable', false,
      'provider_presence_terminal', true,
      'provider_session_id', v_provider_session_id,
      'provider_joined_at', v_joined_at,
      'provider_joined_event_id', v_joined_provider_event_id,
      'provider_left_at', v_left_at,
      'provider_left_event_id', v_left_provider_event_id,
      'owner_state', v_owner_state,
      'source', v_source
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'provider_backed_current', true,
    'provider_presence_required', true,
    'provider_presence_missing', false,
    'provider_presence_terminal', false,
    'provider_session_id', v_provider_session_id,
    'provider_joined_at', v_joined_at,
    'provider_joined_event_id', v_joined_provider_event_id,
    'provider_left_at', v_left_at,
    'provider_left_event_id', v_left_provider_event_id,
    'owner_state', v_owner_state,
    'source', v_source
  );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_alive_strict_provider_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_alive(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
      RENAME TO vd_alive_strict_provider_base;
  END IF;

  IF to_regprocedure('public.vd_alive_strict_provider_base(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing Daily alive base for strict provider wrapper';
  END IF;
END
$$;

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
  v_actor uuid := NULL;
  v_session public.video_sessions%ROWTYPE;
  v_eligibility jsonb := '{}'::jsonb;
  v_provider jsonb := '{}'::jsonb;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_payload jsonb;
  v_reason_code text;
  v_observed boolean := false;
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

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'mark_video_date_daily_alive'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    v_payload := v_eligibility || jsonb_build_object(
      'rpc', 'mark_video_date_daily_alive',
      'provider_presence_required', true,
      'provider_backed_current', false,
      'provider_presence_missing', true,
      'join_stamp_accepted', false,
      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
      'owner_state', v_owner_state,
      'lifecycle_eligibility_checked', true
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      v_payload
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_provider := public.video_date_current_provider_session_proof_v1(
    p_session_id,
    v_actor,
    v_provider_session_id,
    v_owner_state,
    'mark_video_date_daily_alive'
  );

  IF COALESCE((v_provider->>'ok')::boolean, false) IS NOT TRUE THEN
    v_reason_code := COALESCE(v_provider->>'code', 'DAILY_JOIN_PROVIDER_PROOF_MISSING');

    BEGIN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        CASE
          WHEN COALESCE((v_provider->>'provider_presence_terminal')::boolean, false)
            THEN 'daily_alive_provider_session_left'
          ELSE 'daily_alive_provider_join_pending'
        END,
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_daily_alive',
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'owner_state', v_owner_state,
          'provider_proof', v_provider,
          'join_stamp_accepted', false,
          'lifecycle_eligibility_checked', true,
          'retryable', COALESCE((v_provider->>'retryable')::boolean, true),
          'rejection_code', v_reason_code
        )
      );
      v_observed := true;
    EXCEPTION
      WHEN OTHERS THEN
        v_observed := false;
    END;

    v_payload := v_provider
      || jsonb_build_object(
        'ok', true,
        'success', true,
        'rpc', 'mark_video_date_daily_alive',
        'error', lower(v_reason_code),
        'code', v_reason_code,
        'error_code', v_reason_code,
        'provider_presence_required', true,
        'provider_backed_current', false,
        'provider_presence_missing', true,
        'join_stamp_accepted', false,
        'waiting_for_stable_copresence', true,
        'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
        'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
        'owner_state', v_owner_state,
        'lifecycle_eligibility_checked', true,
        'provider_join_webhook_required', true,
        'provider_proof_observed', v_observed
      );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      v_payload
    );
  END IF;

  RETURN COALESCE(public.vd_alive_strict_provider_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  ), '{}'::jsonb) || jsonb_build_object(
    'strict_provider_join_proof_checked', true,
    'provider_join_webhook_required', true,
    'provider_proof', v_provider,
    'lifecycle_eligibility_checked', true
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
      'mark_video_date_daily_alive',
      'daily_alive_stamp_failed',
      'DAILY_ALIVE_STAMP_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_remote_seen_render_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_remote_seen(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text)
      RENAME TO vd_remote_seen_render_base;
  END IF;

  IF to_regprocedure('public.vd_remote_seen_render_base(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing remote-seen provider/current-call base for render wrapper';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL,
  p_evidence_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_eligibility jsonb := '{}'::jsonb;
  v_source text := NULLIF(left(btrim(COALESCE(p_evidence_source, '')), 80), '');
  v_allowed_sources text[] := ARRAY[
    'loadeddata',
    'playing',
    'remote_track_mounted',
    'first_remote_frame',
    'request_video_frame_callback'
  ];
  v_result jsonb;
  v_payload jsonb;
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

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'mark_video_date_remote_seen'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    v_payload := v_eligibility || jsonb_build_object(
      'rpc', 'mark_video_date_remote_seen',
      'provider_presence_required', true,
      'owner_call_presence_required', true,
      'render_evidence_required', true,
      'remote_seen_stamp_accepted', false,
      'p_evidence_source', v_source,
      'allowed_evidence_sources', to_jsonb(v_allowed_sources),
      'lifecycle_eligibility_checked', true
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    );
  END IF;

  IF v_source IS NULL OR NOT (v_source = ANY (v_allowed_sources)) THEN
    v_payload := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'remote_seen_render_evidence_required',
      'code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
      'error_code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
      'retryable', true,
      'retry_after_ms', 1500,
      'provider_presence_required', true,
      'owner_call_presence_required', true,
      'render_evidence_required', true,
      'remote_seen_stamp_accepted', false,
      'p_evidence_source', v_source,
      'allowed_evidence_sources', to_jsonb(v_allowed_sources),
      'lifecycle_eligibility_checked', true
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    );
  END IF;

  v_result := public.vd_remote_seen_render_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'render_evidence_required', true,
    'render_evidence_accepted', true,
    'p_evidence_source', v_source,
    'allowed_evidence_sources', to_jsonb(v_allowed_sources),
    'lifecycle_eligibility_checked', true
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
      'mark_video_date_remote_seen',
      'remote_seen_stamp_failed',
      'REMOTE_SEEN_STAMP_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_provider_overlap_eligible_base(uuid, uuid, text, text, boolean)') IS NULL
     AND to_regprocedure('public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
      RENAME TO vd_provider_overlap_eligible_base;
  END IF;

  IF to_regprocedure('public.vd_provider_overlap_eligible_base(uuid, uuid, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'missing provider-overlap promotion base for lifecycle eligibility wrapper';
  END IF;

  IF to_regprocedure('public.vd_auto_promote_eligible_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_handshake_auto_promote_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
      RENAME TO vd_auto_promote_eligible_base;
  END IF;

  IF to_regprocedure('public.vd_auto_promote_eligible_base(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing auto-promote base for lifecycle eligibility wrapper';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.video_date_promote_provider_overlap_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_provider_overlap_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := p_actor;
  v_session public.video_sessions%ROWTYPE;
  v_eligibility jsonb := '{}'::jsonb;
  v_payload jsonb;
BEGIN
  IF v_actor IS NULL AND p_require_participant IS NOT TRUE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_actor := v_session.participant_1_id;
    END IF;
  END IF;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    COALESCE(NULLIF(btrim(p_source), ''), 'video_date_promote_provider_overlap_v1')
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    v_payload := v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'promotion_blocked_by_lifecycle_eligibility', true
    );

    RETURN v_payload;
  END IF;

  RETURN COALESCE(public.vd_provider_overlap_eligible_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason,
    p_require_participant
  ), '{}'::jsonb) || jsonb_build_object(
    'lifecycle_eligibility_checked', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(
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
  v_eligibility jsonb := '{}'::jsonb;
  v_payload jsonb;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    v_payload := v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'promotion_blocked_by_lifecycle_eligibility', true
    );

    RETURN v_payload;
  END IF;

  RETURN COALESCE(public.vd_auto_promote_eligible_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  ), '{}'::jsonb) || jsonb_build_object(
    'lifecycle_eligibility_checked', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_lifecycle_eligibility_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_session_lifecycle_eligibility_v1(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_current_provider_session_proof_v1(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_current_provider_session_proof_v1(uuid, uuid, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_alive_strict_provider_base(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_alive_strict_provider_base(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.vd_remote_seen_render_base(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_remote_seen_render_base(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.vd_provider_overlap_eligible_base(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_provider_overlap_eligible_base(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_auto_promote_eligible_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_auto_promote_eligible_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_session_lifecycle_eligibility_v1(uuid, uuid, text) IS
  'Service-only Video Date lifecycle eligibility helper for joined/remote_seen/promotion RPCs. Requires active event, current event registrations pointing at the session, and both participants eligible.';

COMMENT ON FUNCTION public.video_date_current_provider_session_proof_v1(uuid, uuid, text, text, text) IS
  'Service-only proof helper for current Daily provider-session presence. Requires a matching participant.joined webhook and no newer matching participant.left webhook.';

COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Strict provider-backed Daily alive heartbeat. Client heartbeats cannot stamp joined until matching Daily joined webhook proof exists for the same provider session.';

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text) IS
  'Render-bound remote_seen RPC. Requires lifecycle eligibility, explicit render/media evidence source, and existing provider/current-call proof before stamping canonical remote_seen.';

COMMENT ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean) IS
  'Provider-overlap promotion guarded by session lifecycle eligibility before delegating to the stable copresence promotion base.';

COMMENT ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text) IS
  'Client handshake auto-promote guarded by session lifecycle eligibility before delegating to provider/confirmed encounter promotion.';

NOTIFY pgrst, 'reload schema';

COMMIT;
