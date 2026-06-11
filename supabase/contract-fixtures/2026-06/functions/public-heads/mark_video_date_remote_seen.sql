CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text, p_evidence_source text DEFAULT NULL::text)
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
$function$
