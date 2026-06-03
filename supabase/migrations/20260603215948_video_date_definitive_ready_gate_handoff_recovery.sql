-- Video Date definitive Ready Gate -> Daily handoff recovery.
--
-- This is a late wrapper migration. It keeps public signatures stable and fixes
-- the observed production loop where a split-ready handoff could briefly lose
-- canonical Daily room metadata, webhooks could no longer find the session by
-- room name, and the handshake deadline could end a launch despite newer Daily
-- join/remote evidence.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_uuid_from_daily_room_name_v1(
  p_room_name text
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_compact text;
BEGIN
  v_compact := substring(lower(btrim(COALESCE(p_room_name, ''))) from '^date-([0-9a-f]{32})$');
  IF v_compact IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN (
    substr(v_compact, 1, 8) || '-' ||
    substr(v_compact, 9, 4) || '-' ||
    substr(v_compact, 13, 4) || '-' ||
    substr(v_compact, 17, 4) || '-' ||
    substr(v_compact, 21, 12)
  )::uuid;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_uuid_from_daily_room_name_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_uuid_from_daily_room_name_v1(text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_uuid_from_daily_room_name_v1(text) IS
  'Private helper that resolves deterministic Daily room names of the form date-<32 hex session id> back to a video_sessions.id.';

CREATE OR REPLACE FUNCTION public.video_date_restore_canonical_room_metadata_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_restore_canonical_room_metadata_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_domain text;
  v_url text;
  v_restored boolean := false;
BEGIN
  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.daily_room_name = v_expected_room_name
     AND v_session.daily_room_url IS NOT NULL
     AND v_session.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'restored', false,
      'room_name', v_session.daily_room_name,
      'room_url', v_session.daily_room_url
    );
  END IF;

  v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

  IF v_domain IS NULL AND v_session.daily_room_url IS NOT NULL THEN
    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
  END IF;

  IF v_domain IS NULL THEN
    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
    INTO v_domain
    FROM public.video_sessions vs
    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
    ORDER BY vs.state_updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
  v_url := 'https://' || v_domain || '/' || v_expected_room_name;

  UPDATE public.video_sessions
  SET
    daily_room_name = v_expected_room_name,
    daily_room_url = v_url,
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'canonical_room_metadata_recovered'
    ),
    state_updated_at = CASE
      WHEN ended_at IS NULL THEN v_now
      ELSE state_updated_at
    END
  WHERE id = p_session_id
    AND (
      daily_room_name IS DISTINCT FROM v_expected_room_name
      OR daily_room_url IS NULL
      OR daily_room_url NOT LIKE ('%/' || v_expected_room_name)
    )
  RETURNING * INTO v_session;

  v_restored := FOUND;

  IF v_restored THEN
    PERFORM public.record_event_loop_observability(
      'video_date_room_metadata',
      'success',
      'canonical_room_metadata_recovered',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'daily_room_name', v_session.daily_room_name,
        'daily_room_url', v_session.daily_room_url,
        'ended_at', v_session.ended_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'restored', v_restored,
    'room_name', v_expected_room_name,
    'room_url', v_url
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_restore_canonical_room_metadata_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_restore_canonical_room_metadata_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_restore_canonical_room_metadata_v1(uuid, text) IS
  'Private deterministic repair for Video Date Daily room metadata. Keeps room name/url consistent from the session id so start snapshots, token refresh, and Daily webhooks agree.';

DROP FUNCTION IF EXISTS public.record_video_date_daily_webhook_event_v2_20260603215948_handoff_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
);

ALTER FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
)
  RENAME TO record_video_date_daily_webhook_event_v2_20260603215948_handoff_base;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2_20260603215948_handoff_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2_20260603215948_handoff_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_daily_webhook_event_v2(
  p_provider_event_id text,
  p_event_type text,
  p_room_name text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  v_session_id := public.video_date_uuid_from_daily_room_name_v1(p_room_name);
  IF v_session_id IS NOT NULL THEN
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      v_session_id,
      'daily_webhook_room_name_restore'
    );
  END IF;

  RETURN public.record_video_date_daily_webhook_event_v2_20260603215948_handoff_base(
    p_provider_event_id,
    p_event_type,
    p_room_name,
    p_provider_participant_id,
    p_provider_user_id,
    p_occurred_at,
    p_payload,
    p_signature_timestamp
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) IS
  'Daily webhook ledger entrypoint. Restores deterministic Video Date room metadata from date-<session> before delegating so webhooks remain associated even after transient metadata loss.';

DROP FUNCTION IF EXISTS public.finalize_video_date_handshake_deadline_20260603215948_handoff_base(
  uuid, uuid, text, text
);

ALTER FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  RENAME TO finalize_video_date_handshake_deadline_20260603215948_handoff_base;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline_20260603215948_handoff_base(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline_20260603215948_handoff_base(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_latest_webhook_join_at timestamptz;
  v_latest_launch_evidence_at timestamptz;
  v_has_explicit_pass boolean := false;
  v_both_decided boolean := false;
  v_due boolean := false;
  v_seconds_remaining integer;
BEGIN
  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'handshake_deadline_preflight'
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF FOUND
     AND v_session.ended_at IS NULL
     AND v_session.state = 'handshake'::public.video_date_state
     AND v_session.date_started_at IS NULL
     AND v_session.handshake_started_at IS NOT NULL
     AND v_session.participant_1_joined_at IS NOT NULL
     AND v_session.participant_2_joined_at IS NOT NULL THEN

    v_due := v_session.handshake_started_at + interval '60 seconds' <= v_now;
    v_has_explicit_pass := (
      (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
      OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
    );
    v_both_decided := v_session.participant_1_decided_at IS NOT NULL
      AND v_session.participant_2_decided_at IS NOT NULL;

    SELECT max(w.occurred_at)
    INTO v_latest_webhook_join_at
    FROM public.video_date_daily_webhook_events w
    WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
      AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
      AND w.occurred_at >= v_session.handshake_started_at;

    v_latest_launch_evidence_at := GREATEST(
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
    );

    IF v_due
       AND NOT v_has_explicit_pass
       AND NOT v_both_decided
       AND v_latest_launch_evidence_at IS NOT NULL
       AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
       AND v_latest_launch_evidence_at > v_session.handshake_started_at THEN
      UPDATE public.video_sessions
      SET
        handshake_started_at = LEAST(v_now, v_latest_launch_evidence_at),
        state_updated_at = v_now
      WHERE id = p_session_id
        AND ended_at IS NULL;

      v_seconds_remaining := GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM ((LEAST(v_now, v_latest_launch_evidence_at) + interval '60 seconds') - v_now)))::int
      );

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'handshake_deadline_extended_for_launch_evidence',
        NULL,
        v_session.event_id,
        p_actor,
        p_session_id,
        jsonb_build_object(
          'action', 'complete_handshake',
          'source', p_source,
          'p_reason', p_reason,
          'previous_handshake_started_at', v_session.handshake_started_at,
          'latest_launch_evidence_at', v_latest_launch_evidence_at,
          'latest_webhook_join_at', v_latest_webhook_join_at,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'seconds_remaining', v_seconds_remaining
        )
      );

      RETURN jsonb_build_object(
        'success', true,
        'state', 'handshake',
        'reason', 'handshake_launch_evidence_extension',
        'seconds_remaining', v_seconds_remaining,
        'extended', true
      );
    END IF;
  END IF;

  RETURN public.finalize_video_date_handshake_deadline_20260603215948_handoff_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text) IS
  'Handshake deadline finalizer with launch-evidence protection. Restores deterministic room metadata, then grants one deadline extension when both Daily joins exist and newer join/remote evidence arrived after the original handshake start.';

COMMIT;
