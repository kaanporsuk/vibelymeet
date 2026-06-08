-- Remove the unused local variable introduced in the provider-bound remote-seen
-- wrapper. Keep the 20260608120000 and 20260608121834 applied migrations
-- immutable; this migration only recreates the public wrapper body.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_owner_id text := NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), '');
  v_call_instance_id text := NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), '');
  v_entry_attempt_id text := NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), '');
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_retryable boolean := false;
  v_rejection_code text := 'REMOTE_SEEN_PROVIDER_NOT_CURRENT';
  v_result jsonb;
  v_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'unauthorized',
      'code', 'UNAUTHORIZED',
      'retryable', false
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_found',
      'code', 'NOT_FOUND',
      'retryable', false
    );
  END IF;

  IF v_actor IS DISTINCT FROM v_row.participant_1_id
     AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'forbidden',
      'code', 'FORBIDDEN',
      'retryable', false
    );
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_ended',
      'code', 'SESSION_ENDED',
      'retryable', false,
      'terminal', true,
      'session_ended', true,
      'ended_at', v_row.ended_at,
      'ended_reason', v_row.ended_reason,
      'provider_session_id', v_provider_session_id,
      'owner_state', v_owner_state
    );
    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    );
  END IF;

  SELECT
    vde.event_type,
    vde.occurred_at,
    public.video_date_daily_provider_session_id_from_event_v1(
      vde.provider_participant_id,
      vde.payload
    )
  INTO
    v_latest_provider_event_type,
    v_latest_provider_event_at,
    v_latest_provider_session_id
  FROM public.video_date_daily_webhook_events vde
  WHERE vde.session_id = p_session_id
    AND vde.provider_user_id = v_actor::text
    AND vde.event_type IN ('participant.joined', 'participant.left')
  ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
  LIMIT 1;

  v_provider_backed_current :=
    v_owner_state = 'joined'
    AND v_provider_session_id IS NOT NULL
    AND v_latest_provider_event_type = 'participant.joined'
    AND v_latest_provider_session_id = v_provider_session_id;

  IF NOT v_provider_backed_current THEN
    v_retryable :=
      v_provider_session_id IS NOT NULL
      AND v_owner_state = 'joined'
      AND (
        v_latest_provider_event_type IS NULL
        OR (
          v_latest_provider_event_type = 'participant.left'
          AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
        )
      );

    v_rejection_code := CASE
      WHEN v_provider_session_id IS NULL THEN 'REMOTE_SEEN_PROVIDER_SESSION_MISSING'
      WHEN v_owner_state IS DISTINCT FROM 'joined' THEN 'REMOTE_SEEN_OWNER_NOT_JOINED'
      WHEN v_latest_provider_event_type = 'participant.left'
           AND v_latest_provider_session_id = v_provider_session_id
        THEN 'REMOTE_SEEN_PROVIDER_SESSION_LEFT'
      ELSE 'REMOTE_SEEN_PROVIDER_NOT_CURRENT'
    END;

    BEGIN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'remote_seen_rejected_stale_provider_session',
        NULL,
        v_row.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_remote_seen',
          'owner_id', v_owner_id,
          'call_instance_id', v_call_instance_id,
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', v_entry_attempt_id,
          'owner_state', v_owner_state,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'latest_provider_event_type', v_latest_provider_event_type,
          'latest_provider_event_at', v_latest_provider_event_at,
          'latest_provider_session_id', v_latest_provider_session_id,
          'join_stamp_accepted', false,
          'remote_seen_stamp_accepted', false,
          'rejection_code', v_rejection_code,
          'retryable', v_retryable
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    v_payload := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', lower(v_rejection_code),
      'code', v_rejection_code,
      'error_code', v_rejection_code,
      'retryable', v_retryable,
      'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
      'provider_presence_required', true,
      'provider_presence_missing', true,
      'provider_presence_terminal',
        v_latest_provider_event_type = 'participant.left'
        AND v_latest_provider_session_id = v_provider_session_id,
      'provider_backed_current', false,
      'join_stamp_accepted', false,
      'remote_seen_stamp_accepted', false,
      'remote_seen_rejected_stale_provider_session', true,
      'owner_id', v_owner_id,
      'call_instance_id', v_call_instance_id,
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', v_entry_attempt_id,
      'owner_state', v_owner_state,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    );
  END IF;

  v_result := public.mark_video_date_remote_seen_20260608120000_provider_base(p_session_id);

  v_payload := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'provider_presence_required', true,
    'provider_backed_current', true,
    'provider_presence_missing', false,
    'provider_presence_terminal', false,
    'remote_seen_stamp_accepted', true,
    'owner_id', v_owner_id,
    'call_instance_id', v_call_instance_id,
    'provider_session_id', v_provider_session_id,
    'entry_attempt_id', v_entry_attempt_id,
    'owner_state', v_owner_state,
    'latest_provider_event_type', v_latest_provider_event_type,
    'latest_provider_event_at', v_latest_provider_event_at,
    'latest_provider_session_id', v_latest_provider_session_id
  );

  RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
    p_session_id,
    v_actor,
    'mark_video_date_remote_seen',
    v_payload
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
        'mark_video_date_remote_seen',
        'remote_seen_stamp_failed',
        'REMOTE_SEEN_STAMP_FAILED',
        true,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        RETURN jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'remote_seen_stamp_failed',
          'code', 'REMOTE_SEEN_STAMP_FAILED',
          'error_code', 'REMOTE_SEEN_STAMP_FAILED',
          'rpc', 'mark_video_date_remote_seen',
          'retryable', true,
          'retry_after_ms', 1500,
          'session_id', p_session_id,
          'actor_id', v_actor,
          'provider_session_id', v_provider_session_id,
          'owner_state', v_owner_state,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms,
          'direct_json_fallback', true
        );
    END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(
  uuid, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(
  uuid, text, text, text, text, text
) IS
  'Marks remote-media evidence only when the actor still has a current provider-backed Daily session matching the supplied owner/call identity.';

NOTIFY pgrst, 'reload schema';

COMMIT;
