-- Address Phase 3 review follow-ups on already-deployed RPCs:
-- 1) Replay credit-extension commands before re-checking mutable room expiry.
-- 2) Return and persist a concrete error when safety report session-end fails.

DROP FUNCTION IF EXISTS public.video_session_extend_date_v2_20260522011000_replay_base(uuid, text, text, text);

ALTER FUNCTION public.video_session_extend_date_v2(uuid, text, text, text)
  RENAME TO video_session_extend_date_v2_20260522011000_replay_base;

REVOKE ALL ON FUNCTION public.video_session_extend_date_v2_20260522011000_replay_base(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.video_session_extend_date_v2(
  p_session_id uuid,
  p_credit_type text,
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
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
  v_add_seconds integer;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_request jsonb;
  v_canonical_hash text;
  v_hash text;
  v_command public.video_session_commands%ROWTYPE;
  v_session public.video_sessions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_add_seconds := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_credit_type');
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_request := jsonb_build_object(
    'action', 'extension',
    'credit_type', v_credit_type
  );
  v_canonical_hash := public.video_date_command_request_hash_v2(
    p_session_id,
    'extension',
    v_request
  );
  v_hash := COALESCE(NULLIF(btrim(p_request_hash), ''), v_canonical_hash);

  SELECT *
  INTO v_command
  FROM public.video_session_commands
  WHERE actor = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.session_id IS DISTINCT FROM p_session_id
       OR v_command.command_kind IS DISTINCT FROM 'extension'
       OR v_command.request_hash IS DISTINCT FROM v_hash
       OR v_command.request_payload IS DISTINCT FROM v_request THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'idempotency_conflict',
        'status', 'idempotency_conflict',
        'commandStatus', 'idempotency_conflict',
        'commandId', v_command.id,
        'existingSessionId', v_command.session_id,
        'existingCommandKind', v_command.command_kind,
        'existingRequestHash', v_command.request_hash
      );
    END IF;

    IF v_command.status IN ('committed', 'rejected') THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      RETURN COALESCE(v_command.result_payload, '{}'::jsonb) || jsonb_build_object(
        'commandStatus', CASE WHEN v_command.status = 'committed' THEN 'replay' ELSE 'replay_rejected' END,
        'commandId', v_command.id,
        'requestHash', v_command.request_hash,
        'date_extra_seconds', COALESCE(v_session.date_extra_seconds, (COALESCE(v_command.result_payload, '{}'::jsonb)->>'date_extra_seconds')::integer),
        'session_seq', COALESCE(v_session.session_seq, (COALESCE(v_command.result_payload, '{}'::jsonb)->>'session_seq')::bigint)
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', 'in_progress',
      'commandId', v_command.id,
      'requestHash', v_command.request_hash
    );
  END IF;

  RETURN public.video_session_extend_date_v2_20260522011000_replay_base(
    p_session_id,
    p_credit_type,
    p_idempotency_key,
    p_request_hash
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_extend_date_v2(uuid, text, text, text) IS
  'Phase 3.7 credit extension wrapper. Replays existing idempotent extension results before mutable room-expiry guards can reject a successful retry.';

DROP FUNCTION IF EXISTS public.submit_video_date_safety_report_v2_20260522011000_error_base(uuid, text, text, boolean, boolean, text);

ALTER FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text)
  RENAME TO submit_video_date_safety_report_v2_20260522011000_error_base;

REVOKE ALL ON FUNCTION public.submit_video_date_safety_report_v2_20260522011000_error_base(uuid, text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_video_date_safety_report_v2(
  p_session_id uuid,
  p_reason text,
  p_details text DEFAULT NULL,
  p_also_block boolean DEFAULT false,
  p_end_session boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_result jsonb;
BEGIN
  v_result := public.submit_video_date_safety_report_v2_20260522011000_error_base(
    p_session_id,
    p_reason,
    p_details,
    p_also_block,
    p_end_session,
    p_idempotency_key
  );

  IF COALESCE((v_result->>'success')::boolean, false) IS FALSE
     AND NOT (v_result ? 'error') THEN
    v_result := v_result || jsonb_build_object('error', 'safety_end_transition_rejected');

    IF v_actor IS NOT NULL AND v_key IS NOT NULL THEN
      UPDATE public.video_session_commands
      SET result_payload = COALESCE(result_payload, '{}'::jsonb)
        || jsonb_build_object('error', 'safety_end_transition_rejected')
      WHERE actor = v_actor
        AND idempotency_key = v_key
        AND session_id = p_session_id
        AND command_kind = 'safety_report'
        AND status = 'rejected'
        AND NOT (COALESCE(result_payload, '{}'::jsonb) ? 'error');
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_video_date_safety_report_v2(uuid, text, text, boolean, boolean, text) IS
  'Phase 3.8 safety-report wrapper. Ensures rejected end-after-report races persist and return a concrete safety_end_transition_rejected error.';
