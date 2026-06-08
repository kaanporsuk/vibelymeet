-- Video Date certification exception closure.
--
-- date_feedback remains the only product finish line. This migration adds a
-- service-owned exception ledger for known historical failed runs that should no
-- longer block release certification after operator review. Exceptions do not
-- create feedback, do not release in_survey users, and are intentionally ignored
-- by queue-drain and client routing gates.

BEGIN;

CREATE TABLE IF NOT EXISTS public.video_date_certification_feedback_exceptions (
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  event_id uuid,
  missing_user_id uuid NOT NULL,
  participant_role text NOT NULL
    CHECK (participant_role IN ('participant_1', 'participant_2')),
  exception_kind text NOT NULL
    CHECK (
      exception_kind IN (
        'known_failed_acceptance_run',
        'historical_unreachable_feedback',
        'operator_certified_non_completion'
      )
    ),
  reason text NOT NULL CHECK (length(trim(reason)) >= 20),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, missing_user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_date_cert_feedback_exceptions_active
  ON public.video_date_certification_feedback_exceptions(event_id, session_id, missing_user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.video_date_certification_feedback_exceptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_date_certification_feedback_exceptions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.video_date_certification_feedback_exceptions
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_certification_feedback_exceptions
  TO service_role;

DROP POLICY IF EXISTS "Admins can view video date certification feedback exceptions"
  ON public.video_date_certification_feedback_exceptions;
CREATE POLICY "Admins can view video date certification feedback exceptions"
ON public.video_date_certification_feedback_exceptions
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.video_date_certification_feedback_exception_active_v1(
  p_session_id uuid,
  p_missing_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.video_date_certification_feedback_exceptions ex
    WHERE ex.session_id = p_session_id
      AND ex.missing_user_id = p_missing_user_id
      AND ex.revoked_at IS NULL
      AND (ex.expires_at IS NULL OR ex.expires_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.upsert_video_date_certification_feedback_exception_v1(
  p_session_id uuid,
  p_missing_user_id uuid,
  p_exception_kind text,
  p_reason text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid;
  v_participant_role text;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_exception_kind text := NULLIF(trim(COALESCE(p_exception_kind, '')), '');
  v_evidence jsonb := COALESCE(p_evidence, '{}'::jsonb);
BEGIN
  IF p_session_id IS NULL OR p_missing_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_session_or_user');
  END IF;

  IF v_exception_kind NOT IN (
    'known_failed_acceptance_run',
    'historical_unreachable_feedback',
    'operator_certified_non_completion'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_exception_kind');
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reason_too_short');
  END IF;

  IF jsonb_typeof(v_evidence) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_must_be_object');
  END IF;

  SELECT
    vs.event_id,
    CASE
      WHEN vs.participant_1_id = p_missing_user_id THEN 'participant_1'
      WHEN vs.participant_2_id = p_missing_user_id THEN 'participant_2'
      ELSE NULL
    END
  INTO v_event_id, v_participant_role
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id;

  IF v_participant_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_participant_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id = p_missing_user_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'date_feedback_already_present',
      'does_not_persist_feedback', true
    );
  END IF;

  INSERT INTO public.video_date_certification_feedback_exceptions (
    session_id,
    event_id,
    missing_user_id,
    participant_role,
    exception_kind,
    reason,
    evidence,
    expires_at,
    revoked_at,
    revoked_reason,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  VALUES (
    p_session_id,
    v_event_id,
    p_missing_user_id,
    v_participant_role,
    v_exception_kind,
    v_reason,
    v_evidence,
    p_expires_at,
    NULL,
    NULL,
    auth.uid(),
    auth.uid(),
    now(),
    now()
  )
  ON CONFLICT (session_id, missing_user_id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    participant_role = EXCLUDED.participant_role,
    exception_kind = EXCLUDED.exception_kind,
    reason = EXCLUDED.reason,
    evidence = EXCLUDED.evidence,
    expires_at = EXCLUDED.expires_at,
    revoked_at = NULL,
    revoked_reason = NULL,
    updated_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'event_id', v_event_id,
    'missing_user_id', p_missing_user_id,
    'participant_role', v_participant_role,
    'exception_kind', v_exception_kind,
    'certification_only', true,
    'does_not_persist_feedback', true,
    'does_not_release_survey', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_video_date_certification_feedback_exception_v1(
  p_session_id uuid,
  p_missing_user_id uuid,
  p_revoked_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_found boolean := false;
BEGIN
  UPDATE public.video_date_certification_feedback_exceptions
  SET
    revoked_at = COALESCE(revoked_at, now()),
    revoked_reason = NULLIF(left(COALESCE(p_revoked_reason, 'operator_revoked'), 500), ''),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE session_id = p_session_id
    AND missing_user_id = p_missing_user_id
    AND revoked_at IS NULL
  RETURNING true INTO v_found;

  RETURN jsonb_build_object(
    'ok', true,
    'found', COALESCE(v_found, false),
    'session_id', p_session_id,
    'missing_user_id', p_missing_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(
  p_event_id uuid DEFAULT NULL,
  p_stale_after interval DEFAULT interval '15 minutes',
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  session_id uuid,
  event_id uuid,
  missing_user_id uuid,
  participant_role text,
  queue_status text,
  ended_at timestamptz,
  age_seconds integer,
  feedback_count integer,
  reminder_status text,
  reminder_sent_at timestamptz,
  release_blocker boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH survey_roles AS (
    SELECT
      vs.id AS session_id,
      vs.event_id,
      vs.ended_at,
      er.queue_status,
      'participant_1'::text AS participant_role,
      vs.participant_1_id AS missing_user_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_1_id
    WHERE (p_event_id IS NULL OR vs.event_id = p_event_id)
      AND er.queue_status = 'in_survey'
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )

    UNION ALL

    SELECT
      vs.id,
      vs.event_id,
      vs.ended_at,
      er.queue_status,
      'participant_2'::text,
      vs.participant_2_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_2_id
    WHERE (p_event_id IS NULL OR vs.event_id = p_event_id)
      AND er.queue_status = 'in_survey'
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
  ),
  feedback_counts AS (
    SELECT df.session_id, count(DISTINCT df.user_id)::integer AS feedback_count
    FROM public.date_feedback df
    GROUP BY df.session_id
  ),
  active_exceptions AS (
    SELECT ex.session_id, ex.missing_user_id
    FROM public.video_date_certification_feedback_exceptions ex
    WHERE ex.revoked_at IS NULL
      AND (ex.expires_at IS NULL OR ex.expires_at > now())
  )
  SELECT
    sr.session_id,
    sr.event_id,
    sr.missing_user_id,
    sr.participant_role,
    sr.queue_status,
    sr.ended_at,
    GREATEST(0, floor(extract(epoch FROM (now() - sr.ended_at))))::integer AS age_seconds,
    COALESCE(fc.feedback_count, 0)::integer AS feedback_count,
    zr.status AS reminder_status,
    zr.reminder_sent_at,
    (
      sr.ended_at <= now() - COALESCE(p_stale_after, interval '15 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df
        WHERE df.session_id = sr.session_id
          AND df.user_id = sr.missing_user_id
      )
      AND ex.session_id IS NULL
    ) AS release_blocker
  FROM survey_roles sr
  LEFT JOIN feedback_counts fc ON fc.session_id = sr.session_id
  LEFT JOIN public.post_date_zero_feedback_reminders zr
    ON zr.session_id = sr.session_id
   AND zr.missing_user_id = sr.missing_user_id
  LEFT JOIN active_exceptions ex
    ON ex.session_id = sr.session_id
   AND ex.missing_user_id = sr.missing_user_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = sr.session_id
      AND df.user_id = sr.missing_user_id
  )
  ORDER BY sr.ended_at DESC, sr.session_id, sr.participant_role
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$function$;

REVOKE ALL ON FUNCTION public.video_date_certification_feedback_exception_active_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_certification_feedback_exception_active_v1(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.upsert_video_date_certification_feedback_exception_v1(uuid, uuid, text, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_video_date_certification_feedback_exception_v1(uuid, uuid, text, text, jsonb, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.revoke_video_date_certification_feedback_exception_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_video_date_certification_feedback_exception_v1(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer)
  TO service_role;

COMMENT ON TABLE public.video_date_certification_feedback_exceptions IS
  'Service-owned certification-only exception ledger for known historical Video Date rows missing date_feedback. Does not complete survey, create date_feedback, or release in_survey users.';

COMMENT ON FUNCTION public.upsert_video_date_certification_feedback_exception_v1(uuid, uuid, text, text, jsonb, timestamptz) IS
  'Service-only operator function to add or refresh a certification-only missing-feedback exception. It refuses rows with existing date_feedback and never writes date_feedback.';

COMMENT ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer) IS
  'Service-only diagnostic for survey-required Video Date participants still missing date_feedback. release_blocker becomes true after p_stale_after unless an active certification-only exception exists.';

COMMIT;
