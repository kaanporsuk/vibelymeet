-- Durable post-date verdict/report idempotency for client outboxes.
-- Not applied automatically; push after review.

CREATE TABLE IF NOT EXISTS public.post_date_client_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('verdict', 'report')),
  idempotency_key text NOT NULL,
  liked boolean,
  report_payload jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_date_client_submissions_key_length
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS post_date_client_submissions_actor_key_idx
  ON public.post_date_client_submissions(actor_id, idempotency_key);

CREATE INDEX IF NOT EXISTS post_date_client_submissions_session_actor_idx
  ON public.post_date_client_submissions(session_id, actor_id, created_at DESC);

ALTER TABLE public.post_date_client_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.post_date_client_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_date_client_submissions TO authenticated;

DROP POLICY IF EXISTS "Users can view own post-date client submissions"
  ON public.post_date_client_submissions;
CREATE POLICY "Users can view own post-date client submissions"
  ON public.post_date_client_submissions
  FOR SELECT
  USING (actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v2(
  p_session_id uuid,
  p_liked boolean,
  p_idempotency_key text,
  p_safety_report jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_submission record;
  v_session record;
  v_target uuid;
  v_report_reason text;
  v_report_details text;
  v_also_block boolean := false;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
  END IF;

  INSERT INTO public.post_date_client_submissions (
    actor_id, session_id, action, idempotency_key, liked, report_payload
  )
  VALUES (v_uid, p_session_id, 'verdict', v_key, p_liked, p_safety_report)
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_submission
  FROM public.post_date_client_submissions
  WHERE actor_id = v_uid
    AND idempotency_key = v_key
  FOR UPDATE;

  IF v_submission.result IS NOT NULL THEN
    RETURN v_submission.result || jsonb_build_object('idempotent', true);
  END IF;
  IF v_submission.session_id IS DISTINCT FROM p_session_id
     OR v_submission.action IS DISTINCT FROM 'verdict' THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key_conflict');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  IF v_uid NOT IN (v_session.participant_1_id, v_session.participant_2_id) THEN
    v_result := jsonb_build_object('success', false, 'error', 'not_participant');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  v_target := CASE WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id ELSE v_session.participant_1_id END;

  IF p_safety_report IS NOT NULL THEN
    IF jsonb_typeof(p_safety_report) IS DISTINCT FROM 'object' THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_report_payload');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;

    v_report_reason := lower(btrim(COALESCE(p_safety_report->>'reason', '')));
    IF v_report_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;

    v_report_details := NULLIF(left(btrim(COALESCE(p_safety_report->>'details', '')), 4000), '');
    v_also_block := lower(COALESCE(p_safety_report->>'alsoBlock', 'false')) = 'true';

    SELECT count(*)::int INTO v_recent
    FROM public.user_reports
    WHERE reporter_id = v_uid
      AND created_at > now() - interval '1 hour';

    IF v_recent >= 20 THEN
      v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;
  END IF;

  v_result := public.submit_post_date_verdict(p_session_id, p_liked);

  IF COALESCE((v_result->>'success')::boolean, true) IS FALSE THEN
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  IF p_safety_report IS NOT NULL THEN
    INSERT INTO public.user_reports (
      reporter_id,
      reported_id,
      reason,
      details,
      also_blocked
    )
    VALUES (
      v_uid,
      v_target,
      v_report_reason,
      v_report_details,
      v_also_block
    )
    RETURNING id INTO v_report_id;

    IF v_also_block THEN
      v_block_result := public.block_user_with_cleanup(v_target, 'Reported: ' || v_report_reason, NULL);
    END IF;

    v_result := v_result || jsonb_build_object(
      'safety_report_recorded', true,
      'report_id', v_report_id,
      'block', v_block_result
    );
  END IF;

  UPDATE public.post_date_client_submissions
  SET result = v_result, updated_at = now()
  WHERE id = v_submission.id;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_post_date_safety_report_v1(
  p_session_id uuid,
  p_idempotency_key text,
  p_safety_report jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_submission record;
  v_session record;
  v_target uuid;
  v_report_reason text;
  v_report_details text;
  v_also_block boolean := false;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
  END IF;
  IF p_safety_report IS NULL OR jsonb_typeof(p_safety_report) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_report_payload');
  END IF;

  INSERT INTO public.post_date_client_submissions (
    actor_id, session_id, action, idempotency_key, report_payload
  )
  VALUES (v_uid, p_session_id, 'report', v_key, p_safety_report)
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_submission
  FROM public.post_date_client_submissions
  WHERE actor_id = v_uid
    AND idempotency_key = v_key
  FOR UPDATE;

  IF v_submission.result IS NOT NULL THEN
    RETURN v_submission.result || jsonb_build_object('idempotent', true);
  END IF;
  IF v_submission.session_id IS DISTINCT FROM p_session_id
     OR v_submission.action IS DISTINCT FROM 'report' THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key_conflict');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  IF v_uid NOT IN (v_session.participant_1_id, v_session.participant_2_id) THEN
    v_result := jsonb_build_object('success', false, 'error', 'not_participant');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  v_target := CASE WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id ELSE v_session.participant_1_id END;
  v_report_reason := lower(btrim(COALESCE(p_safety_report->>'reason', '')));
  IF v_report_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
    v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  v_report_details := NULLIF(left(btrim(COALESCE(p_safety_report->>'details', '')), 4000), '');
  v_also_block := lower(COALESCE(p_safety_report->>'alsoBlock', 'false')) = 'true';

  SELECT count(*)::int INTO v_recent
  FROM public.user_reports
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  INSERT INTO public.user_reports (
    reporter_id,
    reported_id,
    reason,
    details,
    also_blocked
  )
  VALUES (
    v_uid,
    v_target,
    v_report_reason,
    v_report_details,
    v_also_block
  )
  RETURNING id INTO v_report_id;

  IF v_also_block THEN
    v_block_result := public.block_user_with_cleanup(v_target, 'Reported: ' || v_report_reason, NULL);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'safety_report_recorded', true,
    'report_id', v_report_id,
    'block', v_block_result,
    'idempotent', false
  );

  UPDATE public.post_date_client_submissions
  SET result = v_result, updated_at = now()
  WHERE id = v_submission.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_post_date_safety_report_v1(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_date_safety_report_v1(uuid, text, jsonb) TO authenticated;

COMMENT ON TABLE public.post_date_client_submissions IS
  'Client idempotency ledger for durable post-date verdict/report outboxes. Stores sanitized final RPC result for retry no-op success.';

COMMENT ON FUNCTION public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb) IS
  'Durable post-date verdict path with client idempotency and optional same-transaction safety report.';

COMMENT ON FUNCTION public.submit_post_date_safety_report_v1(uuid, text, jsonb) IS
  'Durable idempotent post-date safety-report path linked to the video session.';
