-- Video Date active-owner, terminal audit, and delayed provider truth closure.
--
-- Additive follow-up only. Earlier applied recovery migrations stay immutable;
-- this migration wraps current public RPCs and adds audit/proof columns so
-- PostgREST callers get structured JSON and terminal timelines are
-- reconstructable even when Daily webhooks arrive after terminalization.

BEGIN;

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS terminal_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_audit_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminal_audit_reason text,
  ADD COLUMN IF NOT EXISTS terminal_audit_source text,
  ADD COLUMN IF NOT EXISTS terminal_audit_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_1_provider_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS participant_2_provider_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS participant_1_provider_left_at timestamptz,
  ADD COLUMN IF NOT EXISTS participant_2_provider_left_at timestamptz;

ALTER TABLE public.video_date_surface_claim_events
  ADD COLUMN IF NOT EXISTS session_terminal_generation integer,
  ADD COLUMN IF NOT EXISTS session_state_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_ended_reason text;

CREATE INDEX IF NOT EXISTS idx_video_sessions_terminal_generation
  ON public.video_sessions (id, terminal_generation)
  WHERE ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_surface_claim_events_terminal_story
  ON public.video_date_surface_claim_events (
    session_id,
    session_terminal_generation,
    created_at DESC,
    id DESC
  );

UPDATE public.video_sessions
SET
  terminal_generation = CASE
    WHEN terminal_generation = 0 THEN 1
    ELSE terminal_generation
  END,
  terminal_audit_at = COALESCE(terminal_audit_at, ended_at, state_updated_at),
  terminal_audit_reason = COALESCE(terminal_audit_reason, ended_reason, 'session_ended'),
  terminal_audit_source = COALESCE(terminal_audit_source, 'terminal_audit_backfill'),
  terminal_audit_detail = COALESCE(terminal_audit_detail, '{}'::jsonb)
    || jsonb_build_object('backfilled', true)
WHERE ended_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.video_date_terminal_audit_stamp_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_terminalizing boolean := false;
  v_terminal_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_terminalizing := NEW.ended_at IS NOT NULL
      OR NEW.state::text = 'ended'
      OR COALESCE(NEW.phase, '') = 'ended';
  ELSE
    v_terminalizing := (
      (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
      OR (
        NEW.ended_at IS NOT NULL
        AND OLD.ended_reason IS DISTINCT FROM NEW.ended_reason
      )
      OR (
        OLD.state IS DISTINCT FROM NEW.state
        AND NEW.state::text = 'ended'
        AND NEW.ended_at IS NOT NULL
      )
      OR (
        OLD.phase IS DISTINCT FROM NEW.phase
        AND COALESCE(NEW.phase, '') = 'ended'
        AND NEW.ended_at IS NOT NULL
      )
    );
  END IF;

  IF NOT v_terminalizing THEN
    RETURN NEW;
  END IF;

  v_terminal_at := COALESCE(NEW.ended_at, NEW.state_updated_at, clock_timestamp());

  IF TG_OP = 'INSERT' THEN
    NEW.terminal_generation := GREATEST(COALESCE(NEW.terminal_generation, 0), 1);
  ELSE
    NEW.terminal_generation := GREATEST(
      COALESCE(NEW.terminal_generation, 0),
      COALESCE(OLD.terminal_generation, 0) + 1
    );
  END IF;

  NEW.terminal_audit_at := COALESCE(NEW.terminal_audit_at, v_terminal_at);
  NEW.terminal_audit_reason := COALESCE(
    NULLIF(NEW.terminal_audit_reason, ''),
    NEW.ended_reason,
    'session_ended'
  );
  NEW.terminal_audit_source := COALESCE(
    NULLIF(NEW.terminal_audit_source, ''),
    'video_date_terminal_audit_stamp_v1'
  );
  NEW.terminal_audit_detail :=
    COALESCE(NEW.terminal_audit_detail, '{}'::jsonb)
    || jsonb_build_object(
      'terminal_generation', NEW.terminal_generation,
      'ended_at', NEW.ended_at,
      'ended_reason', NEW.ended_reason,
      'state', NEW.state::text,
      'phase', NEW.phase
    );

  IF NEW.state_updated_at IS NULL OR NEW.state_updated_at < v_terminal_at THEN
    NEW.state_updated_at := v_terminal_at;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_video_sessions_terminal_audit_stamp
  ON public.video_sessions;
CREATE TRIGGER trg_video_sessions_terminal_audit_stamp
  BEFORE INSERT OR UPDATE ON public.video_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.video_date_terminal_audit_stamp_v1();

CREATE OR REPLACE FUNCTION public.video_date_direct_json_fallback_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_error text,
  p_code text,
  p_retryable boolean DEFAULT true,
  p_sqlstate text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  RETURN jsonb_build_object(
    'ok', false,
    'success', false,
    'session_id', p_session_id,
    'actor_id', p_actor_id,
    'rpc', COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc'),
    'error', COALESCE(NULLIF(btrim(p_error), ''), 'lifecycle_rpc_failed'),
    'reason', COALESCE(NULLIF(btrim(p_error), ''), 'lifecycle_rpc_failed'),
    'code', COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED'),
    'error_code', COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED'),
    'retryable', COALESCE(p_retryable, true),
    'retry_after_ms', CASE WHEN COALESCE(p_retryable, true) THEN 1500 ELSE NULL END,
    'terminal', false,
    'sqlstate', p_sqlstate,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms,
    'direct_json_fallback', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_terminal_audit_stamp_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_terminal_audit_stamp_v1()
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_direct_json_fallback_v1(
  uuid, uuid, text, text, text, boolean, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_direct_json_fallback_v1(
  uuid, uuid, text, text, text, boolean, text
) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.vd_mark_ready_terminal_truth_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO vd_mark_ready_terminal_truth_base;
  END IF;

  IF to_regprocedure('public.vd_claim_surface_terminal_truth_base(uuid, text, text, boolean, integer)') IS NULL
     AND to_regprocedure('public.claim_video_date_surface(uuid, text, text, boolean, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
      RENAME TO vd_claim_surface_terminal_truth_base;
  END IF;

  IF to_regprocedure('public.vd_daily_webhook_terminal_truth_base(text,text,text,text,text,timestamptz,jsonb,timestamptz)') IS NULL
     AND to_regprocedure('public.record_video_date_daily_webhook_event_v2(text,text,text,text,text,timestamptz,jsonb,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.record_video_date_daily_webhook_event_v2(
      text, text, text, text, text, timestamptz, jsonb, timestamptz
    ) RENAME TO vd_daily_webhook_terminal_truth_base;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.vd_mark_ready_terminal_truth_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_mark_ready_terminal_truth_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_claim_surface_terminal_truth_base(
  uuid, text, text, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_claim_surface_terminal_truth_base(
  uuid, text, text, boolean, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.vd_daily_webhook_terminal_truth_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_daily_webhook_terminal_truth_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

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
    v_result := public.vd_mark_ready_terminal_truth_base(
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
      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_session_mark_ready_v2',
          'mark_ready_unavailable',
          'MARK_READY_UNAVAILABLE',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN public.video_date_direct_json_fallback_v1(
            p_session_id,
            v_actor,
            'video_session_mark_ready_v2',
            'mark_ready_unavailable',
            'MARK_READY_UNAVAILABLE',
            true,
            SQLSTATE
          );
      END;
  END;

  BEGIN
    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      v_result
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN COALESCE(v_result, '{}'::jsonb)
        - 'message'
        - 'detail'
        - 'hint'
        || jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', p_session_id,
          'error', 'mark_ready_enrichment_failed',
          'reason', 'mark_ready_enrichment_failed',
          'code', 'MARK_READY_ENRICHMENT_FAILED',
          'error_code', 'MARK_READY_ENRICHMENT_FAILED',
          'retryable', true
        );
  END;
EXCEPTION
  WHEN OTHERS THEN
    RETURN public.video_date_direct_json_fallback_v1(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      'mark_ready_wrapper_failed',
      'MARK_READY_WRAPPER_FAILED',
      true,
      SQLSTATE
    );
END;
$function$;

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
  v_actor uuid := NULL;
  v_result jsonb;
  v_session record;
  v_updated integer := 0;
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
    v_result := public.vd_claim_surface_terminal_truth_base(
      p_session_id,
      p_surface,
      p_client_instance_id,
      p_takeover,
      p_ttl_seconds
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

  SELECT
    vs.id,
    vs.event_id,
    vs.terminal_generation,
    vs.state_updated_at,
    vs.ended_at,
    vs.ended_reason,
    vs.terminal_audit_at,
    vs.terminal_audit_reason
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id;

  IF FOUND THEN
    UPDATE public.video_date_surface_claim_events e
    SET
      session_terminal_generation = v_session.terminal_generation,
      session_state_updated_at = v_session.state_updated_at,
      session_ended_at = v_session.ended_at,
      session_ended_reason = v_session.ended_reason,
      detail = COALESCE(e.detail, '{}'::jsonb)
        || jsonb_build_object(
          'session_terminal_generation', v_session.terminal_generation,
          'session_state_updated_at', v_session.state_updated_at,
          'session_ended_at', v_session.ended_at,
          'session_ended_reason', v_session.ended_reason,
          'terminal_audit_at', v_session.terminal_audit_at,
          'terminal_audit_reason', v_session.terminal_audit_reason
        )
    WHERE e.id IN (
      SELECT recent.id
      FROM public.video_date_surface_claim_events recent
      WHERE recent.session_id = p_session_id
        AND recent.surface = COALESCE(NULLIF(p_surface, ''), recent.surface)
        AND (
          p_client_instance_id IS NULL
          OR recent.client_instance_id = p_client_instance_id
        )
      ORDER BY recent.created_at DESC, recent.id DESC
      LIMIT 3
    );

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
      INSERT INTO public.video_date_surface_claim_events (
        session_id,
        surface,
        actor_id,
        client_instance_id,
        action,
        takeover,
        ttl_seconds,
        ok,
        blocked,
        retryable,
        result_code,
        detail,
        session_terminal_generation,
        session_state_updated_at,
        session_ended_at,
        session_ended_reason
      ) VALUES (
        p_session_id,
        COALESCE(NULLIF(p_surface, ''), 'video_date'),
        v_actor,
        NULLIF(p_client_instance_id, ''),
        'claim_terminal_audit',
        COALESCE(p_takeover, false),
        p_ttl_seconds,
        lower(COALESCE(v_result->>'ok', v_result->>'success', 'false')) IN ('true', 't', '1', 'yes'),
        lower(COALESCE(v_result->>'blocked', 'false')) IN ('true', 't', '1', 'yes'),
        lower(COALESCE(v_result->>'retryable', 'false')) IN ('true', 't', '1', 'yes'),
        COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error'),
        COALESCE(v_result, '{}'::jsonb)
          || jsonb_build_object(
            'session_terminal_generation', v_session.terminal_generation,
            'session_state_updated_at', v_session.state_updated_at,
            'session_ended_at', v_session.ended_at,
            'session_ended_reason', v_session.ended_reason,
            'terminal_audit_at', v_session.terminal_audit_at,
            'terminal_audit_reason', v_session.terminal_audit_reason
          ),
        v_session.terminal_generation,
        v_session.state_updated_at,
        v_session.ended_at,
        v_session.ended_reason
      );
    END IF;

    v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'session_terminal_generation', v_session.terminal_generation,
      'session_state_updated_at', v_session.state_updated_at,
      'session_ended_at', v_session.ended_at,
      'session_ended_reason', v_session.ended_reason
    );
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
      'claim_video_date_surface',
      'surface_claim_wrapper_failed',
      'SURFACE_CLAIM_WRAPPER_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_preserve_provider_webhook_truth_v1(
  p_room_name text,
  p_event_type text,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');
  v_event_kind text := replace(replace(lower(btrim(COALESCE(p_event_type, ''))), '_', '.'), '-', '.');
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
  v_actor uuid;
  v_session public.video_sessions%ROWTYPE;
  v_actor_role text;
  v_provider_session_id text;
  v_is_join boolean := false;
  v_is_left boolean := false;
  v_rows_changed integer := 0;
BEGIN
  IF v_room_name IS NULL
     OR v_event_kind NOT IN ('participant.joined', 'participant.join', 'participant.left', 'participant.leave') THEN
    RETURN jsonb_build_object('ok', true, 'preserved', false, 'reason', 'not_provider_presence_event');
  END IF;

  IF COALESCE(p_provider_user_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok', true, 'preserved', false, 'reason', 'provider_user_id_missing_or_non_uuid');
  END IF;

  v_actor := p_provider_user_id::uuid;
  v_provider_session_id := public.video_date_daily_provider_session_id_from_event_v1(
    p_provider_participant_id,
    p_payload
  );
  v_is_join := v_event_kind IN ('participant.joined', 'participant.join');
  v_is_left := v_event_kind IN ('participant.left', 'participant.leave');

  SELECT *
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.daily_room_name = v_room_name
  ORDER BY vs.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'preserved', false, 'reason', 'session_not_found');
  END IF;

  IF v_actor = v_session.participant_1_id THEN
    v_actor_role := 'participant_1';
  ELSIF v_actor = v_session.participant_2_id THEN
    v_actor_role := 'participant_2';
  ELSE
    RETURN jsonb_build_object(
      'ok', true,
      'preserved', false,
      'session_id', v_session.id,
      'reason', 'provider_user_not_participant'
    );
  END IF;

  IF v_actor_role = 'participant_1' THEN
    UPDATE public.video_sessions
    SET
      participant_1_provider_joined_at = CASE
        WHEN v_is_join THEN GREATEST(
          COALESCE(participant_1_provider_joined_at, v_occurred_at),
          v_occurred_at
        )
        ELSE participant_1_provider_joined_at
      END,
      participant_1_provider_left_at = CASE
        WHEN v_is_left THEN GREATEST(
          COALESCE(participant_1_provider_left_at, v_occurred_at),
          v_occurred_at
        )
        ELSE participant_1_provider_left_at
      END,
      terminal_audit_detail = CASE
        WHEN ended_at IS NOT NULL THEN
          COALESCE(terminal_audit_detail, '{}'::jsonb)
          || jsonb_build_object(
            'delayed_provider_truth_preserved', true,
            'latest_delayed_provider_event_type', v_event_kind,
            'latest_delayed_provider_event_at', v_occurred_at,
            'latest_delayed_provider_actor_id', v_actor,
            'latest_delayed_provider_actor_role', v_actor_role,
            'latest_delayed_provider_session_id', v_provider_session_id
          )
        ELSE terminal_audit_detail
      END
    WHERE id = v_session.id;
  ELSE
    UPDATE public.video_sessions
    SET
      participant_2_provider_joined_at = CASE
        WHEN v_is_join THEN GREATEST(
          COALESCE(participant_2_provider_joined_at, v_occurred_at),
          v_occurred_at
        )
        ELSE participant_2_provider_joined_at
      END,
      participant_2_provider_left_at = CASE
        WHEN v_is_left THEN GREATEST(
          COALESCE(participant_2_provider_left_at, v_occurred_at),
          v_occurred_at
        )
        ELSE participant_2_provider_left_at
      END,
      terminal_audit_detail = CASE
        WHEN ended_at IS NOT NULL THEN
          COALESCE(terminal_audit_detail, '{}'::jsonb)
          || jsonb_build_object(
            'delayed_provider_truth_preserved', true,
            'latest_delayed_provider_event_type', v_event_kind,
            'latest_delayed_provider_event_at', v_occurred_at,
            'latest_delayed_provider_actor_id', v_actor,
            'latest_delayed_provider_actor_role', v_actor_role,
            'latest_delayed_provider_session_id', v_provider_session_id
          )
        ELSE terminal_audit_detail
      END
    WHERE id = v_session.id;
  END IF;

  GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

  INSERT INTO public.video_date_presence_events (
    session_id,
    actor_id,
    source,
    event_type,
    provider_session_id,
    owner_state,
    occurred_at,
    details
  ) VALUES (
    v_session.id,
    v_actor,
    'daily_webhook_historical_truth',
    CASE WHEN v_is_join THEN 'provider_participant_joined' ELSE 'provider_participant_left' END,
    v_provider_session_id,
    CASE WHEN v_is_join THEN 'joined' ELSE 'left' END,
    v_occurred_at,
    jsonb_build_object(
      'room_name', v_room_name,
      'event_type', v_event_kind,
      'actor_role', v_actor_role,
      'provider_user_id', p_provider_user_id,
      'provider_participant_id', p_provider_participant_id,
      'provider_session_id', v_provider_session_id,
      'session_ended', v_session.ended_at IS NOT NULL,
      'state_mutation_allowed', v_session.ended_at IS NULL,
      'historical_provider_truth_preserved', v_rows_changed > 0
    )
  );

  IF v_session.ended_at IS NOT NULL THEN
    BEGIN
      PERFORM public.record_event_loop_observability(
        'daily_webhook_historical_truth',
        'success',
        'delayed_provider_truth_preserved_after_terminal',
        NULL,
        v_session.event_id,
        v_actor,
        v_session.id,
        jsonb_build_object(
          'event_type', v_event_kind,
          'occurred_at', v_occurred_at,
          'actor_role', v_actor_role,
          'provider_session_id', v_provider_session_id,
          'ended_at', v_session.ended_at,
          'ended_reason', v_session.ended_reason
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'preserved', v_rows_changed > 0,
    'session_id', v_session.id,
    'event_id', v_session.event_id,
    'actor_id', v_actor,
    'actor_role', v_actor_role,
    'provider_session_id', v_provider_session_id,
    'event_type', v_event_kind,
    'occurred_at', v_occurred_at,
    'session_ended', v_session.ended_at IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_video_date_daily_webhook_event_v2(
  p_provider_event_id text,
  p_event_type text,
  p_room_name text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base jsonb;
  v_truth jsonb := NULL;
BEGIN
  v_base := public.vd_daily_webhook_terminal_truth_base(
    p_provider_event_id,
    p_event_type,
    p_room_name,
    p_provider_participant_id,
    p_provider_user_id,
    p_occurred_at,
    p_payload,
    p_signature_timestamp
  );

  IF COALESCE(v_base->>'state', '') IN ('processed', 'duplicate')
     OR 'ignored_terminal_session' IN (
       COALESCE(v_base->>'result', ''),
       COALESCE(v_base->>'processing_result', ''),
       COALESCE(v_base->>'reason', '')
     )
     OR 'IGNORED_TERMINAL_SESSION' IN (
       COALESCE(v_base->>'code', ''),
       COALESCE(v_base->>'error_code', '')
     ) THEN
    v_truth := public.video_date_preserve_provider_webhook_truth_v1(
      p_room_name,
      p_event_type,
      p_provider_participant_id,
      p_provider_user_id,
      p_occurred_at,
      p_payload
    );
  END IF;

  RETURN COALESCE(v_base, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'historical_provider_truth', v_truth
    ));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_webhook_record_failed',
      'reason', 'daily_webhook_record_failed',
      'code', 'DAILY_WEBHOOK_RECORD_FAILED',
      'error_code', 'DAILY_WEBHOOK_RECORD_FAILED',
      'retryable', true,
      'sqlstate', SQLSTATE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_date_preserve_provider_webhook_truth_v1(
  text, text, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_preserve_provider_webhook_truth_v1(
  text, text, text, text, timestamptz, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON COLUMN public.video_sessions.terminal_generation IS
  'Monotonic terminal-story generation stamped atomically when Video Date enters or changes terminal state.';
COMMENT ON COLUMN public.video_sessions.terminal_audit_at IS
  'Timestamp used to reconstruct the authoritative terminal audit story.';
COMMENT ON COLUMN public.video_sessions.terminal_audit_detail IS
  'Terminal audit JSON, including delayed provider webhook truth that arrives after lifecycle terminalization.';
COMMENT ON COLUMN public.video_sessions.participant_1_provider_joined_at IS
  'Historical Daily provider joined proof ordered by webhook occurred_at; safe to update after terminal.';
COMMENT ON COLUMN public.video_sessions.participant_2_provider_joined_at IS
  'Historical Daily provider joined proof ordered by webhook occurred_at; safe to update after terminal.';
COMMENT ON COLUMN public.video_date_surface_claim_events.session_terminal_generation IS
  'Terminal generation copied from video_sessions when the surface claim event is created or enriched.';
COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant Ready Gate mark-ready RPC with final PostgREST JSON shield and lifecycle payload sanitization.';
COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Video Date surface ownership RPC enriched with terminal-generation audit fields for chronological reconstruction.';
COMMENT ON FUNCTION public.record_video_date_daily_webhook_event_v2(text, text, text, text, text, timestamptz, jsonb, timestamptz) IS
  'Daily webhook recorder that preserves delayed provider joined/left truth by occurred_at even after terminalization.';

NOTIFY pgrst, 'reload schema';

COMMIT;
