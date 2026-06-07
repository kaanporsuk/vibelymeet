-- Video Date lifecycle RPC terminal contracts.
--
-- The latest production run reached a real provider-backed Daily date, then
-- continued active-date polling/reconnect/surface work while server truth had
-- already terminalized the confirmed encounter into survey-required state.
-- Some browser/native-callable RPCs still leaked raw 500s at that boundary.
--
-- Keep the existing implementation stack intact and add one final public
-- fail-soft layer with shared terminal context for web, mobile web, and native.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_terminal_context_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_queue_status text := NULL;
  v_current_room_id uuid := NULL;
  v_feedback_exists boolean := false;
  v_survey_required boolean := false;
  v_terminal boolean := false;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id
    );
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT er.queue_status, er.current_room_id
    INTO v_queue_status, v_current_room_id
    FROM public.event_registrations er
    WHERE er.event_id = v_row.event_id
      AND er.profile_id = p_actor_id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = p_session_id
        AND df.user_id = p_actor_id
    )
    INTO v_feedback_exists;
  END IF;

  v_terminal :=
    v_row.ended_at IS NOT NULL
    OR v_row.state::text = 'ended'
    OR COALESCE(v_row.phase, '') = 'ended';

  v_survey_required :=
    v_queue_status = 'in_survey'
    OR public.video_date_session_is_post_date_survey_eligible_v2(
      v_row.ended_at,
      v_row.ended_reason,
      v_row.date_started_at,
      v_row.state::text,
      v_row.phase,
      v_row.participant_1_joined_at,
      v_row.participant_2_joined_at,
      v_row.participant_1_remote_seen_at,
      v_row.participant_2_remote_seen_at
    );

  RETURN jsonb_build_object(
    'terminal_context_available', true,
    'session_id', v_row.id,
    'event_id', v_row.event_id,
    'state', v_row.state::text,
    'phase', v_row.phase,
    'ready_gate_status', v_row.ready_gate_status,
    'session_ended', v_terminal,
    'terminal', v_terminal,
    'ended_at', v_row.ended_at,
    'ended_reason', v_row.ended_reason,
    'survey_required', v_survey_required,
    'queue_status', v_queue_status,
    'current_room_id', v_current_room_id,
    'date_started_at', v_row.date_started_at,
    'handshake_started_at', v_row.handshake_started_at,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
    'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
    'daily_room_name', v_row.daily_room_name,
    'daily_room_url', v_row.daily_room_url,
    'feedback_exists', v_feedback_exists
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id,
      'terminal_context_error', SQLSTATE,
      'terminal_context_message', SQLERRM
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_failsoft_payload_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_error text,
  p_code text,
  p_retryable boolean DEFAULT true,
  p_sqlstate text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_detail text DEFAULT NULL,
  p_hint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_context jsonb;
  v_code text := COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED');
  v_error text := COALESCE(NULLIF(btrim(p_error), ''), lower(v_code));
  v_session_ended boolean := false;
  v_survey_required boolean := false;
  v_retryable boolean := COALESCE(p_retryable, true);
  v_server_now_ms bigint;
BEGIN
  v_context := public.video_date_lifecycle_terminal_context_v1(
    p_session_id,
    p_actor_id
  );
  v_session_ended :=
    COALESCE((v_context ->> 'session_ended')::boolean, false)
    OR lower(v_error) = 'session_ended'
    OR upper(v_code) = 'SESSION_ENDED';
  v_survey_required :=
    COALESCE((v_context ->> 'survey_required')::boolean, false)
    OR v_context ->> 'queue_status' = 'in_survey';
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_session_ended OR v_survey_required THEN
    v_retryable := false;
  END IF;

  RETURN v_context || jsonb_build_object(
    'ok', false,
    'success', false,
    'error', v_error,
    'code', v_code,
    'error_code', v_code,
    'rpc', p_rpc,
    'sqlstate', p_sqlstate,
    'message', p_message,
    'detail', NULLIF(p_detail, ''),
    'hint', NULLIF(p_hint, ''),
    'retryable', v_retryable,
    'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms,
    'session_ended', v_session_ended,
    'terminal', v_session_ended OR COALESCE((v_context ->> 'terminal')::boolean, false),
    'survey_required', v_survey_required
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_failsoft_payload_v1(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_failsoft_payload_v1(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.claim_video_date_surface_20260607155414_lifecycle_base(uuid, text, text, boolean, integer)') IS NULL
     AND to_regprocedure('public.claim_video_date_surface(uuid, text, text, boolean, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
      RENAME TO claim_video_date_surface_20260607155414_lifecycle_base;
  END IF;

  IF to_regprocedure('public.get_or_seed_video_session_vibe_questions_20260607155414_lifecycle_base(uuid, jsonb)') IS NULL
     AND to_regprocedure('public.get_or_seed_video_session_vibe_questions(uuid, jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
      RENAME TO get_or_seed_video_session_vibe_questions_20260607155414_lifecycle_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_alive_20260607155414_lifecycle_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_alive(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_alive_20260607155414_lifecycle_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_joined_20260607155414_lifecycle_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_joined(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_joined_20260607155414_lifecycle_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_remote_seen_20260607155414_lifecycle_base(uuid)') IS NULL
     AND to_regprocedure('public.mark_video_date_remote_seen(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_remote_seen(uuid)
      RENAME TO mark_video_date_remote_seen_20260607155414_lifecycle_base;
  END IF;

  IF to_regprocedure('public.video_date_transition_20260607155414_lifecycle_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260607155414_lifecycle_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface_20260607155414_lifecycle_base(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface_20260607155414_lifecycle_base(uuid, text, text, boolean, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions_20260607155414_lifecycle_base(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions_20260607155414_lifecycle_base(uuid, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive_20260607155414_lifecycle_base(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive_20260607155414_lifecycle_base(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260607155414_lifecycle_base(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260607155414_lifecycle_base(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen_20260607155414_lifecycle_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen_20260607155414_lifecycle_base(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_transition_20260607155414_lifecycle_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260607155414_lifecycle_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_enrich_lifecycle_payload_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_code text := lower(COALESCE(v_payload ->> 'code', v_payload ->> 'error_code', v_payload ->> 'error', ''));
  v_state text := lower(COALESCE(v_payload ->> 'state', ''));
  v_phase text := lower(COALESCE(v_payload ->> 'phase', ''));
  v_needs_context boolean := false;
  v_context jsonb;
BEGIN
  v_needs_context :=
    v_code IN ('session_ended', 'session ended')
    OR upper(COALESCE(v_payload ->> 'code', v_payload ->> 'error_code', '')) = 'SESSION_ENDED'
    OR COALESCE((v_payload ->> 'terminal')::boolean, false)
    OR COALESCE((v_payload ->> 'session_ended')::boolean, false)
    OR COALESCE((v_payload ->> 'survey_required')::boolean, false)
    OR v_payload ->> 'queue_status' = 'in_survey'
    OR v_state = 'ended'
    OR v_phase = 'ended'
    OR v_payload ? 'ended_at';

  IF NOT v_needs_context THEN
    RETURN v_payload;
  END IF;

  v_context := public.video_date_lifecycle_terminal_context_v1(
    p_session_id,
    p_actor_id
  );

  IF COALESCE((v_context ->> 'session_ended')::boolean, false)
     OR COALESCE((v_context ->> 'survey_required')::boolean, false)
     OR v_context ->> 'queue_status' = 'in_survey' THEN
    RETURN v_payload || v_context || jsonb_build_object(
      'retryable', false,
      'session_ended', COALESCE((v_context ->> 'session_ended')::boolean, false),
      'terminal', COALESCE((v_context ->> 'terminal')::boolean, false),
      'survey_required', COALESCE((v_context ->> 'survey_required')::boolean, false)
    );
  END IF;

  RETURN v_payload || v_context;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(
  p_session_id uuid,
  p_surface text,
  p_client_instance_id text,
  p_takeover boolean DEFAULT false,
  p_ttl_seconds integer DEFAULT 12
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
  v_result := public.claim_video_date_surface_20260607155414_lifecycle_base(
    p_session_id,
    p_surface,
    p_client_instance_id,
    p_takeover,
    p_ttl_seconds
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'claim_video_date_surface',
      'surface_claim_failed',
      'SURFACE_CLAIM_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_seed_video_session_vibe_questions(
  p_session_id uuid,
  p_questions jsonb
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
  v_result := public.get_or_seed_video_session_vibe_questions_20260607155414_lifecycle_base(
    p_session_id,
    p_questions
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'get_or_seed_video_session_vibe_questions',
      'vibe_questions_seed_failed',
      'VIBE_QUESTIONS_SEED_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    ) || jsonb_build_object('seeded', false, 'questions', '[]'::jsonb);
END;
$function$;

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
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.mark_video_date_daily_alive_20260607155414_lifecycle_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
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

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
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
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.mark_video_date_daily_joined_20260607155414_lifecycle_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_joined',
      'daily_join_stamp_failed',
      'DAILY_JOIN_STAMP_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
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
  v_result := public.mark_video_date_remote_seen_20260607155414_lifecycle_base(
    p_session_id
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      'remote_seen_failed',
      'REMOTE_SEEN_FAILED',
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
  v_result := public.video_date_transition_20260607155414_lifecycle_base(
    p_session_id,
    p_action,
    p_reason
  );
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'video_date_transition',
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

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid) IS
  'Shared terminal/survey context for exposed Video Date lifecycle RPC fail-soft wrappers.';
COMMENT ON FUNCTION public.video_date_lifecycle_failsoft_payload_v1(uuid, uuid, text, text, text, boolean, text, text, text, text) IS
  'Builds structured retryable or terminal JSON for exposed Video Date lifecycle RPC exceptions.';
COMMENT ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb) IS
  'Adds terminal survey context to existing Video Date lifecycle RPC payloads without changing their base behavior.';
COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Outermost terminal-aware fail-soft wrapper around Video Date surface ownership.';
COMMENT ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) IS
  'Outermost terminal-aware fail-soft wrapper around Video Date vibe question seeding.';
COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Outermost terminal-aware fail-soft wrapper around provider-backed Daily alive heartbeats.';
COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Outermost terminal-aware fail-soft wrapper around provider-backed Daily joined confirmation.';
COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Outermost terminal-aware fail-soft wrapper around remote media evidence stamping.';
COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Outermost terminal-aware fail-soft wrapper around Video Date lifecycle transitions.';

NOTIFY pgrst, 'reload schema';

COMMIT;
