-- Vibely Video Date Sprint 6:
-- make swipe-result latency a first-class durable launch checkpoint.
--
-- Additive wrapper only:
-- - Handles the new authenticated participant-only `swipe_result` checkpoint.
-- - Delegates every existing checkpoint to the previously installed function.
-- - Stores no PII, provider secrets, tokens, or media URLs.

DROP FUNCTION IF EXISTS public.record_vd_launch_latency_202605252340_base(uuid, text, jsonb, integer);

ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  RENAME TO record_vd_launch_latency_202605252340_base;

REVOKE ALL ON FUNCTION public.record_vd_launch_latency_202605252340_base(uuid, text, jsonb, integer)
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
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_latency_ms integer;
  v_outcome text;
  v_detail jsonb;
BEGIN
  IF v_checkpoint = 'swipe_result' THEN
    IF v_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
    END IF;

    IF v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
    END IF;

    v_latency_ms := COALESCE(
      public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
      CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
      public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
    );

    v_outcome := CASE
      WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
        THEN v_payload->>'outcome'
      ELSE 'success'
    END;

    v_detail := jsonb_strip_nulls(jsonb_build_object(
      'client_event_name', 'ready_gate_to_date_latency_checkpoint',
      'checkpoint', v_checkpoint,
      'platform', CASE
        WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
        ELSE NULL
      END,
      'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
      'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
      'outcome', v_outcome,
      'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
      'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
      'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
      'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
      'swipe_result_ms', public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
      'observed_at', now()
    ));

    INSERT INTO public.event_loop_observability_events (
      operation,
      outcome,
      reason_code,
      latency_ms,
      event_id,
      actor_id,
      session_id,
      detail
    ) VALUES (
      'video_date_launch_latency_checkpoint',
      v_outcome,
      v_checkpoint,
      v_latency_ms,
      v_session.event_id,
      v_actor,
      p_session_id,
      v_detail
    );

    RETURN jsonb_build_object('ok', true, 'inserted', true);
  END IF;

  BEGIN
    RETURN public.record_vd_launch_latency_202605252340_base(
      p_session_id,
      p_checkpoint,
      p_payload,
      p_latency_ms
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insert_failed');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated;

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated participant-only launch-latency checkpoint ingestion for Video Date. Sprint 6 adds explicit swipe_result latency while delegating all existing checkpoints unchanged.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260525234000',
  'Video date Sprint 6 swipe-result latency checkpoint',
  'schema+policy',
  'Additive wrapper for record_video_date_launch_latency_checkpoint. New swipe_result checkpoint is participant-only, token-free, and delegates all prior checkpoints unchanged.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
