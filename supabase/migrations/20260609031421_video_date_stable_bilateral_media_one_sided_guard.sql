BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_stable_bilateral_media_gate_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_heartbeat_ready boolean := false;
  v_bilateral_remote_seen boolean := false;
  v_one_remote_seen boolean := false;
  v_stable_bilateral_media boolean := false;
  v_reason text := 'missing_session';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', false,
      'stable_copresence', false,
      'waiting_for_stable_copresence', true,
      'reason', 'session_id_required',
      'retry_after_ms', 750
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', false,
      'stable_copresence', false,
      'waiting_for_stable_copresence', true,
      'reason', v_reason,
      'retry_after_ms', 750
    );
  END IF;

  IF v_session.date_started_at IS NOT NULL
     OR v_session.state = 'date'::public.video_date_state
     OR v_session.phase = 'date' THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', true,
      'stable_copresence', true,
      'waiting_for_stable_copresence', false,
      'reason', 'already_date',
      'retry_after_ms', 0
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
  v_one_remote_seen := COALESCE((v_stable->>'one_remote_seen')::boolean, false);
  v_heartbeat_ready :=
    v_stable_copresence
    AND NOT v_one_remote_seen
    AND COALESCE((v_stable->>'heartbeat_overlap')::boolean, false)
    AND COALESCE((v_stable->>'heartbeat_fresh')::boolean, false);
  v_bilateral_remote_seen :=
    v_stable_copresence
    AND COALESCE((v_stable->>'remote_seen')::boolean, false)
    AND NOT v_one_remote_seen;
  v_stable_bilateral_media := v_heartbeat_ready OR v_bilateral_remote_seen;

  IF v_stable_bilateral_media THEN
    v_reason := CASE
      WHEN v_heartbeat_ready THEN 'stable_bilateral_owner_heartbeat'
      ELSE 'stable_bilateral_remote_seen'
    END;
  ELSIF v_one_remote_seen THEN
    v_reason := 'bilateral_remote_seen_required';
  ELSIF NOT v_stable_copresence THEN
    v_reason := COALESCE(v_stable->>'reason', 'stable_copresence_not_ready');
  ELSIF NOT COALESCE((v_stable->>'heartbeat_overlap')::boolean, false) THEN
    v_reason := 'bilateral_owner_heartbeat_overlap_required';
  ELSIF NOT COALESCE((v_stable->>'heartbeat_fresh')::boolean, false) THEN
    v_reason := 'fresh_bilateral_owner_heartbeat_required';
  ELSE
    v_reason := 'stable_bilateral_media_required';
  END IF;

  RETURN jsonb_build_object(
    'stable_bilateral_media', v_stable_bilateral_media,
    'stable_copresence', v_stable_copresence,
    'waiting_for_stable_copresence', NOT v_stable_bilateral_media,
    'reason', v_reason,
    'retry_after_ms', CASE WHEN v_stable_bilateral_media THEN 0 ELSE 750 END,
    'heartbeat_ready', v_heartbeat_ready,
    'bilateral_remote_seen', v_bilateral_remote_seen,
    'one_remote_seen', v_one_remote_seen,
    'stable_copresence_detail', v_stable
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid) IS
  'Service-only Video Date promotion gate. Date promotion requires already-date truth, fresh bilateral owner heartbeat with no one-sided remote-seen asymmetry, or bilateral render-bound remote-seen proof.';

COMMIT;
