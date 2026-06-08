-- Video Date missing-feedback certification closure.
--
-- date_feedback remains the only finish line. The existing
-- post_date_pending_verdicts ledger handles one-sided verdicts after the first
-- participant submits. This migration adds the missing companion path for
-- ended, survey-eligible Video Dates where neither participant has submitted
-- yet, so web/native/mobile survey stalls can be reminded and diagnosed by the
-- shared backend worker instead of remaining invisible warning rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.post_date_zero_feedback_reminders (
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  event_id uuid,
  missing_user_id uuid NOT NULL,
  registration_id uuid,
  participant_role text NOT NULL
    CHECK (participant_role IN ('participant_1', 'participant_2')),
  queue_status text,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reminder_eligible_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  reminder_sent_at timestamptz,
  reminder_error text,
  stale_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reminded', 'stale', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, missing_user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_date_zero_feedback_reminders_due
  ON public.post_date_zero_feedback_reminders(reminder_eligible_at, first_detected_at)
  WHERE reminder_sent_at IS NULL
    AND completed_at IS NULL
    AND stale_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_date_zero_feedback_reminders_stale
  ON public.post_date_zero_feedback_reminders(first_detected_at)
  WHERE completed_at IS NULL
    AND stale_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_date_zero_feedback_reminders_missing_user
  ON public.post_date_zero_feedback_reminders(missing_user_id)
  WHERE completed_at IS NULL;

ALTER TABLE public.post_date_zero_feedback_reminders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.post_date_zero_feedback_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_date_zero_feedback_reminders TO authenticated;

DROP POLICY IF EXISTS "Admins can view zero-feedback post-date reminders"
  ON public.post_date_zero_feedback_reminders;
CREATE POLICY "Admins can view zero-feedback post-date reminders"
ON public.post_date_zero_feedback_reminders
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.sync_post_date_zero_feedback_reminders_v1(
  p_older_than interval DEFAULT interval '5 minutes',
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH eligible_roles AS (
    SELECT
      vs.id AS session_id,
      vs.event_id,
      vs.ended_at,
      er.id AS registration_id,
      er.queue_status,
      'participant_1'::text AS participant_role,
      vs.participant_1_id AS missing_user_id,
      vs.participant_2_id AS partner_user_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_1_id
    WHERE vs.ended_at IS NOT NULL
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
      AND vs.ended_at <= now() - COALESCE(p_older_than, interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df_any
        WHERE df_any.session_id = vs.id
      )

    UNION ALL

    SELECT
      vs.id,
      vs.event_id,
      vs.ended_at,
      er.id,
      er.queue_status,
      'participant_2'::text,
      vs.participant_2_id,
      vs.participant_1_id
    FROM public.video_sessions vs
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = vs.participant_2_id
    WHERE vs.ended_at IS NOT NULL
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
      AND vs.ended_at <= now() - COALESCE(p_older_than, interval '5 minutes')
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df_any
        WHERE df_any.session_id = vs.id
      )
  ),
  limited_roles AS (
    SELECT er.*
    FROM eligible_roles er
    WHERE NOT public.is_blocked(er.missing_user_id, er.partner_user_id)
      AND NOT public.is_blocked(er.partner_user_id, er.missing_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = er.missing_user_id AND ur.reported_id = er.partner_user_id)
           OR (ur.reporter_id = er.partner_user_id AND ur.reported_id = er.missing_user_id)
      )
    ORDER BY er.ended_at, er.session_id, er.participant_role
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 1000))
  ),
  upserted AS (
    INSERT INTO public.post_date_zero_feedback_reminders (
      session_id,
      event_id,
      missing_user_id,
      registration_id,
      participant_role,
      queue_status,
      first_detected_at,
      last_seen_at,
      reminder_eligible_at,
      status,
      created_at,
      updated_at
    )
    SELECT
      lr.session_id,
      lr.event_id,
      lr.missing_user_id,
      lr.registration_id,
      lr.participant_role,
      lr.queue_status,
      lr.ended_at,
      now(),
      GREATEST(lr.ended_at + COALESCE(p_older_than, interval '5 minutes'), now()),
      'pending',
      now(),
      now()
    FROM limited_roles lr
    ON CONFLICT (session_id, missing_user_id) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      registration_id = EXCLUDED.registration_id,
      participant_role = EXCLUDED.participant_role,
      queue_status = EXCLUDED.queue_status,
      last_seen_at = now(),
      reminder_eligible_at = CASE
        WHEN public.post_date_zero_feedback_reminders.reminder_sent_at IS NULL
          THEN LEAST(public.post_date_zero_feedback_reminders.reminder_eligible_at, EXCLUDED.reminder_eligible_at)
        ELSE public.post_date_zero_feedback_reminders.reminder_eligible_at
      END,
      completed_at = NULL,
      status = CASE
        WHEN public.post_date_zero_feedback_reminders.stale_at IS NOT NULL THEN 'stale'
        WHEN public.post_date_zero_feedback_reminders.reminder_sent_at IS NOT NULL THEN 'reminded'
        ELSE 'pending'
      END,
      updated_at = now()
    RETURNING 1
  ),
  completed AS (
    UPDATE public.post_date_zero_feedback_reminders zr
    SET
      completed_at = COALESCE(zr.completed_at, now()),
      status = 'completed',
      updated_at = now()
    WHERE zr.completed_at IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.date_feedback df
          WHERE df.session_id = zr.session_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM public.video_sessions vs
          JOIN public.event_registrations er
            ON er.event_id = vs.event_id
           AND er.profile_id = zr.missing_user_id
          WHERE vs.id = zr.session_id
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
        )
      )
    RETURNING 1
  )
  SELECT COALESCE((SELECT count(*) FROM upserted), 0)::integer
  INTO v_count;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_post_date_zero_feedback_reminders_stale_v1(
  p_older_than interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    WITH stale AS (
      SELECT zr.session_id, zr.missing_user_id
      FROM public.post_date_zero_feedback_reminders zr
      WHERE zr.completed_at IS NULL
        AND zr.stale_at IS NULL
        AND zr.first_detected_at < now() - COALESCE(p_older_than, interval '24 hours')
      ORDER BY zr.first_detected_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
      FOR UPDATE SKIP LOCKED
    ),
    updated AS (
      UPDATE public.post_date_zero_feedback_reminders zr
      SET
        stale_at = now(),
        status = 'stale',
        updated_at = now()
      FROM stale
      WHERE zr.session_id = stale.session_id
        AND zr.missing_user_id = stale.missing_user_id
      RETURNING
        zr.session_id,
        zr.event_id,
        zr.missing_user_id,
        zr.participant_role,
        zr.first_detected_at
    )
    SELECT * FROM updated
  LOOP
    n := n + 1;
    PERFORM public.record_event_loop_observability(
      'post_date_zero_feedback_stale',
      'success',
      'survey_feedback_missing',
      NULL,
      r.event_id,
      r.missing_user_id,
      r.session_id,
      jsonb_build_object(
        'participant_role', r.participant_role,
        'first_detected_at', r.first_detected_at
      )
    );
  END LOOP;

  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_post_date_zero_feedback_reminders_v1(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  session_id uuid,
  event_id uuid,
  missing_user_id uuid,
  participant_role text,
  first_detected_at timestamptz,
  reminder_sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.sync_post_date_zero_feedback_reminders_v1(
    interval '5 minutes',
    GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT zr.session_id, zr.missing_user_id
    FROM public.post_date_zero_feedback_reminders zr
    JOIN public.video_sessions vs ON vs.id = zr.session_id
    JOIN public.event_registrations er
      ON er.event_id = vs.event_id
     AND er.profile_id = zr.missing_user_id
    WHERE zr.completed_at IS NULL
      AND zr.stale_at IS NULL
      AND zr.reminder_sent_at IS NULL
      AND zr.reminder_eligible_at <= now()
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df_any
        WHERE df_any.session_id = zr.session_id
      )
    ORDER BY zr.first_detected_at, zr.session_id, zr.participant_role
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    FOR UPDATE OF zr SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.post_date_zero_feedback_reminders zr
    SET
      reminder_sent_at = now(),
      reminder_error = NULL,
      status = 'reminded',
      updated_at = now()
    FROM candidates
    WHERE zr.session_id = candidates.session_id
      AND zr.missing_user_id = candidates.missing_user_id
    RETURNING
      zr.session_id,
      zr.event_id,
      zr.missing_user_id,
      zr.participant_role,
      zr.first_detected_at,
      zr.reminder_sent_at
  )
  SELECT
    claimed.session_id,
    claimed.event_id,
    claimed.missing_user_id,
    claimed.participant_role,
    claimed.first_detected_at,
    claimed.reminder_sent_at
  FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_post_date_zero_feedback_reminder_result_v1(
  p_session_id uuid,
  p_missing_user_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.post_date_zero_feedback_reminders
  SET
    reminder_error = CASE WHEN COALESCE(p_success, false) THEN NULL ELSE NULLIF(left(COALESCE(p_error, 'unknown_error'), 500), '') END,
    updated_at = now()
  WHERE session_id = p_session_id
    AND missing_user_id = p_missing_user_id;
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
    ) AS release_blocker
  FROM survey_roles sr
  LEFT JOIN feedback_counts fc ON fc.session_id = sr.session_id
  LEFT JOIN public.post_date_zero_feedback_reminders zr
    ON zr.session_id = sr.session_id
   AND zr.missing_user_id = sr.missing_user_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = sr.session_id
      AND df.user_id = sr.missing_user_id
  )
  ORDER BY sr.ended_at DESC, sr.session_id, sr.participant_role
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$function$;

REVOKE ALL ON FUNCTION public.sync_post_date_zero_feedback_reminders_v1(interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_post_date_zero_feedback_reminders_v1(interval, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_post_date_zero_feedback_reminders_stale_v1(interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_post_date_zero_feedback_reminders_stale_v1(interval, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_post_date_zero_feedback_reminders_v1(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_post_date_zero_feedback_reminders_v1(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_post_date_zero_feedback_reminder_result_v1(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_post_date_zero_feedback_reminder_result_v1(uuid, uuid, boolean, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer)
  TO service_role;

COMMENT ON TABLE public.post_date_zero_feedback_reminders IS
  'Service-owned reminder ledger for ended survey-eligible Video Dates where neither participant has submitted date_feedback yet.';

COMMENT ON FUNCTION public.claim_post_date_zero_feedback_reminders_v1(integer) IS
  'Claims per-user reminders for zero-feedback survey-required Video Dates. Complements post_date_pending_verdicts, which handles one-sided verdicts after the first date_feedback row.';

COMMENT ON FUNCTION public.video_date_missing_feedback_operator_diagnostics_v1(uuid, interval, integer) IS
  'Service-only diagnostic for survey-required Video Date participants still missing date_feedback; release_blocker becomes true after p_stale_after.';

DO $$
DECLARE
  v_bad_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_bad_count
  FROM public.video_sessions vs
  WHERE (
      vs.ready_gate_status = 'ready_a'
      AND (vs.ready_participant_1_at IS NULL OR vs.ready_participant_2_at IS NOT NULL)
    )
    OR (
      vs.ready_gate_status = 'ready_b'
      AND (vs.ready_participant_2_at IS NULL OR vs.ready_participant_1_at IS NOT NULL)
    )
    OR (
      vs.ready_gate_status = 'both_ready'
      AND (vs.ready_participant_1_at IS NULL OR vs.ready_participant_2_at IS NULL)
    );

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'video_sessions_ready_gate_timestamp_consistency has % historical violation(s)', v_bad_count
      USING ERRCODE = 'check_violation';
  END IF;

  ALTER TABLE public.video_sessions
    VALIDATE CONSTRAINT video_sessions_ready_gate_timestamp_consistency;
END
$$;

COMMIT;
