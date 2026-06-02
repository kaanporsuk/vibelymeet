-- Fix Supabase lint/runtime safety for enum comparisons in the Daily token
-- refresh provider limiter. Do not coalesce enum columns with a text literal.

BEGIN;

CREATE OR REPLACE FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(
  p_session_id uuid,
  p_bucket text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bucket text := btrim(lower(COALESCE(p_bucket, '')));
  v_scoped_bucket text;
  v_capacity integer;
  v_refill numeric;
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated', 'retryAfterSeconds', 30);
  END IF;

  SELECT vs.id, vs.state, vs.phase, vs.ended_at
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant', 'retryAfterSeconds', 30);
  END IF;

  IF v_session.ended_at IS NOT NULL
    OR NOT (
      COALESCE(v_session.state::text, '') IN ('handshake', 'date')
      OR COALESCE(v_session.phase::text, '') IN ('handshake', 'date')
    )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_active', 'retryAfterSeconds', 30);
  END IF;

  IF v_bucket = 'room_lookup' THEN
    v_capacity := 15;
    v_refill := 5;
  ELSIF v_bucket = 'meeting_token' THEN
    v_capacity := 20;
    v_refill := 10;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rate_limit_bucket', 'retryAfterSeconds', 30);
  END IF;

  v_scoped_bucket := concat(v_bucket, ':session:', p_session_id::text, ':user:', v_uid::text);

  RETURN public.take_provider_rate_limit_token_v1(
    'daily',
    v_scoped_bucket,
    1,
    v_capacity,
    v_refill
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text) IS
  'Caller-authenticated Daily provider limiter for video-date token refresh room lookup and meeting-token calls; buckets are scoped per session and participant.';

NOTIFY pgrst, 'reload schema';

COMMIT;
