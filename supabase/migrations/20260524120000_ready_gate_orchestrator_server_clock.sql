-- Phase 2 Ready Gate orchestrator: every canonical transition response carries
-- the authoritative database clock so web/native countdowns do not rely on a
-- client-local fallback deadline.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260524120000_clock_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260524120000_clock_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260524120000_clock_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
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
  v_result jsonb;
  v_server_now_ms bigint;
BEGIN
  v_result := public.ready_gate_transition_20260524120000_clock_base(
    p_session_id,
    p_action,
    p_reason
  );
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Delegates unchanged transition semantics and enriches every response with authoritative server clock milliseconds for Ready Gate orchestrator clients.';
