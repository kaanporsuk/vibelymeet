-- Golden-flow lean pass (2026-06-11): batch variant of the launch-latency
-- checkpoint recorder.
--
-- Evidence (2026-06-10 successful run + pg_stat_statements):
-- record_video_date_launch_latency_checkpoint fires ~30 single RPCs per
-- launch (one per checkpoint) and is the #2 cumulative DB consumer
-- (~2,927s over 8k calls in 15 days; mean 362ms on the current compute).
-- Each call is a separate PostgREST round trip + transaction.
--
-- This additive RPC lets clients buffer checkpoints briefly and flush them
-- in one round trip / one transaction. Each item is processed through the
-- EXISTING public fail-soft shell record_video_date_launch_latency_checkpoint
-- (hot-path no-throw, delegates to vd_launch_latency_20260609130139_hot_base),
-- so per-checkpoint validation, observability, and failure semantics are
-- byte-identical to the single-call path. The single RPC remains in place and
-- is still used as the client fallback if a batch flush fails.

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoints_v1(
  p_session_id uuid,
  p_checkpoints jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ok_count integer := 0;
  v_count integer := 0;
  v_latency integer;
BEGIN
  IF p_session_id IS NULL
     OR p_checkpoints IS NULL
     OR jsonb_typeof(p_checkpoints) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'rpc', 'record_video_date_launch_latency_checkpoints_v1',
      'code', 'INVALID_BATCH',
      'error_code', 'INVALID_BATCH',
      'retryable', false,
      'terminal', false
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_checkpoints)
    LIMIT 40
  LOOP
    v_count := v_count + 1;
    v_latency := CASE
      WHEN (v_item->>'latency_ms') ~ '^[0-9]{1,9}$' THEN (v_item->>'latency_ms')::integer
      ELSE NULL
    END;
    v_result := public.record_video_date_launch_latency_checkpoint(
      p_session_id,
      v_item->>'checkpoint',
      CASE
        WHEN jsonb_typeof(v_item->'payload') = 'object' THEN v_item->'payload'
        ELSE '{}'::jsonb
      END,
      v_latency
    );
    IF COALESCE((v_result->>'ok')::boolean, false) THEN
      v_ok_count := v_ok_count + 1;
    END IF;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'checkpoint', lower(btrim(COALESCE(v_item->>'checkpoint', ''))),
        'ok', COALESCE((v_result->>'ok')::boolean, false)
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'rpc', 'record_video_date_launch_latency_checkpoints_v1',
    'session_id', p_session_id,
    'count', v_count,
    'ok_count', v_ok_count,
    'results', v_results,
    'batched', true
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'rpc', 'record_video_date_launch_latency_checkpoints_v1',
      'code', 'LAUNCH_LATENCY_BATCH_FAILED',
      'error_code', 'LAUNCH_LATENCY_BATCH_FAILED',
      'retryable', true,
      'terminal', false,
      'sqlstate', SQLSTATE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoints_v1(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoints_v1(uuid, jsonb) TO authenticated, service_role;
