-- Preserve backend prepare-entry sub-timings on durable launch-latency
-- checkpoints. The base ingestion function remains the owner of auth,
-- participant access, checkpoint allowlisting, and the initial append-only
-- insert; this wrapper only patches safe timing dimensions onto the row it
-- just inserted.

DROP FUNCTION IF EXISTS public.record_video_date_launch_latency_checkpoint_20260506101000_prepare_timing_base(uuid, text, jsonb, integer);

ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  RENAME TO record_video_date_launch_latency_checkpoint_20260506101000_prepare_timing_base;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint_20260506101000_prepare_timing_base(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_result jsonb;
  v_extra jsonb;
BEGIN
  BEGIN
    v_result := public.record_video_date_launch_latency_checkpoint_20260506101000_prepare_timing_base(
      p_session_id,
      p_checkpoint,
      p_payload,
      p_latency_ms
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
  END;

  IF COALESCE((v_result->>'inserted')::boolean, false) AND v_actor IS NOT NULL THEN
    BEGIN
      v_extra := jsonb_strip_nulls(jsonb_build_object(
        'provider_verify_reason', public.video_date_launch_latency_safe_text(v_payload->>'provider_verify_reason'),
        'auth_ms', public.video_date_launch_latency_safe_int(v_payload->>'auth_ms', 0, 86400000),
        'prepare_rpc_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_rpc_ms', 0, 86400000),
        'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
        'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
        'confirm_prepare_ms', public.video_date_launch_latency_safe_int(v_payload->>'confirm_prepare_ms', 0, 86400000),
        'edge_total_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_total_ms', 0, 86400000)
      ));

      IF v_extra <> '{}'::jsonb THEN
        UPDATE public.event_loop_observability_events
        SET detail = detail || v_extra
        WHERE id = (
          SELECT id
          FROM public.event_loop_observability_events
          WHERE operation = 'video_date_launch_latency_checkpoint'
            AND actor_id = v_actor
            AND session_id = p_session_id
            AND reason_code = v_checkpoint
          ORDER BY created_at DESC
          LIMIT 1
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN v_result;
    END;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. '
  'Adds sanitized prepare-entry timing slices: auth_ms, prepare_rpc_ms, '
  'room_create_or_verify_ms, token_ms, confirm_prepare_ms, edge_total_ms, '
  'and provider_verify_reason.';
