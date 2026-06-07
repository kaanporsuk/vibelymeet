-- Video Date lifecycle RPC truthy helper alignment.
--
-- The terminal-contract wrappers from 20260607155414 are live, but their
-- shared payload helpers still used direct JSON boolean casts. This follow-up
-- keeps the public RPC surface unchanged while making terminal/survey payload
-- enrichment tolerant of stringy or missing booleans on web, mobile web, and
-- native clients.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_jsonb_true_v1(
  p_payload jsonb,
  p_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT lower(COALESCE(p_payload ->> p_key, '')) IN ('true', 't', '1', 'yes', 'y', 'on');
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_jsonb_true_v1(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_jsonb_true_v1(jsonb, text)
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
    public.video_date_lifecycle_jsonb_true_v1(v_context, 'session_ended')
    OR lower(v_error) = 'session_ended'
    OR upper(v_code) = 'SESSION_ENDED';
  v_survey_required :=
    public.video_date_lifecycle_jsonb_true_v1(v_context, 'survey_required')
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
    'terminal', v_session_ended OR public.video_date_lifecycle_jsonb_true_v1(v_context, 'terminal'),
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
    OR public.video_date_lifecycle_jsonb_true_v1(v_payload, 'terminal')
    OR public.video_date_lifecycle_jsonb_true_v1(v_payload, 'session_ended')
    OR public.video_date_lifecycle_jsonb_true_v1(v_payload, 'survey_required')
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

  IF public.video_date_lifecycle_jsonb_true_v1(v_context, 'session_ended')
     OR public.video_date_lifecycle_jsonb_true_v1(v_context, 'survey_required')
     OR v_context ->> 'queue_status' = 'in_survey' THEN
    RETURN v_payload || v_context || jsonb_build_object(
      'retryable', false,
      'session_ended', public.video_date_lifecycle_jsonb_true_v1(v_context, 'session_ended'),
      'terminal', public.video_date_lifecycle_jsonb_true_v1(v_context, 'terminal'),
      'survey_required', public.video_date_lifecycle_jsonb_true_v1(v_context, 'survey_required')
    );
  END IF;

  RETURN v_payload || v_context;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.video_date_lifecycle_jsonb_true_v1(jsonb, text) IS
  'Tolerant JSON boolean reader used by Video Date lifecycle fail-soft wrappers.';
COMMENT ON FUNCTION public.video_date_lifecycle_failsoft_payload_v1(uuid, uuid, text, text, text, boolean, text, text, text, text) IS
  'Builds structured retryable or terminal JSON for exposed Video Date lifecycle RPC exceptions with tolerant terminal booleans.';
COMMENT ON FUNCTION public.video_date_enrich_lifecycle_payload_v1(uuid, uuid, jsonb) IS
  'Adds terminal survey context to existing Video Date lifecycle RPC payloads with tolerant terminal booleans.';

NOTIFY pgrst, 'reload schema';

COMMIT;
