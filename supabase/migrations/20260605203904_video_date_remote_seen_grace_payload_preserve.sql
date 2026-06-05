BEGIN;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_latest_away_at timestamptz;
  v_latest_remote_seen_at timestamptz;
  v_rows_changed integer := 0;
  v_base_reconnect_grace_cleared boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.mark_video_date_remote_seen_20260605200729_grace_base(p_session_id);
  v_base_reconnect_grace_cleared := COALESCE(
    CASE
      WHEN jsonb_typeof(v_result->'reconnect_grace_cleared') = 'boolean'
        THEN (v_result->>'reconnect_grace_cleared')::boolean
      ELSE NULL
    END,
    false
  );

  IF COALESCE(
       CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
       false
     ) THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND v_session.reconnect_grace_ends_at IS NOT NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      v_latest_away_at := GREATEST(
        COALESCE(v_session.participant_1_away_at, '-infinity'::timestamptz),
        COALESCE(v_session.participant_2_away_at, '-infinity'::timestamptz)
      );
      v_latest_remote_seen_at := GREATEST(
        COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
        COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
      );

      IF v_latest_away_at <> '-infinity'::timestamptz
         AND v_latest_remote_seen_at >= v_latest_away_at THEN
        UPDATE public.video_sessions
        SET
          participant_1_away_at = NULL,
          participant_2_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND reconnect_grace_ends_at IS NOT NULL;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        IF v_rows_changed > 0 THEN
          PERFORM public.bump_video_session_seq(p_session_id);
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'reconnect_grace_cleared_by_remote_seen',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'mark_video_date_remote_seen',
              'latest_away_at', v_latest_away_at,
              'latest_remote_seen_at', v_latest_remote_seen_at,
              'reconnect_grace_cleared', true,
              'base_reconnect_grace_cleared', v_base_reconnect_grace_cleared
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'reconnect_grace_cleared',
    v_base_reconnect_grace_cleared OR v_rows_changed > 0
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'remote_seen_failed',
      'code', 'REMOTE_SEEN_FAILED',
      'error_code', 'REMOTE_SEEN_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Marks remote-media evidence through the existing base stack and clears reconnect grace when newer remote-media proof shows the pair recovered. Preserves base reconnect_grace_cleared=true in the outer JSON response.';

NOTIFY pgrst, 'reload schema';

COMMIT;
