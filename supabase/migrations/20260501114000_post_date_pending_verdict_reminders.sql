-- Sprint F: server-owned post-date pending-verdict reminder + stale tracking.
-- date_feedback remains the verdict source of truth. This table tracks the
-- missing partner for one-sided verdicts so a cron-owned worker can send one
-- neutral reminder and operators can see stale outcomes.

CREATE TABLE IF NOT EXISTS public.post_date_pending_verdicts (
  session_id uuid PRIMARY KEY REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  event_id uuid,
  submitted_by uuid NOT NULL,
  missing_user_id uuid NOT NULL,
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
  CONSTRAINT post_date_pending_verdicts_distinct_users
    CHECK (submitted_by IS DISTINCT FROM missing_user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_date_pending_verdicts_missing_user
  ON public.post_date_pending_verdicts(missing_user_id)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_date_pending_verdicts_reminder_due
  ON public.post_date_pending_verdicts(reminder_eligible_at)
  WHERE reminder_sent_at IS NULL
    AND completed_at IS NULL
    AND stale_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_date_pending_verdicts_stale_due
  ON public.post_date_pending_verdicts(first_detected_at)
  WHERE completed_at IS NULL
    AND stale_at IS NULL;

ALTER TABLE public.post_date_pending_verdicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.post_date_pending_verdicts FROM PUBLIC;
REVOKE ALL ON TABLE public.post_date_pending_verdicts FROM anon;
REVOKE ALL ON TABLE public.post_date_pending_verdicts FROM authenticated;
GRANT SELECT ON TABLE public.post_date_pending_verdicts TO authenticated;

DROP POLICY IF EXISTS "Admins can view pending post-date verdicts"
  ON public.post_date_pending_verdicts;
CREATE POLICY "Admins can view pending post-date verdicts"
ON public.post_date_pending_verdicts
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.post_date_pending_verdicts (
  session_id,
  event_id,
  submitted_by,
  missing_user_id,
  first_detected_at,
  last_seen_at,
  reminder_eligible_at,
  stale_at,
  status,
  created_at,
  updated_at
)
SELECT
  vs.id,
  vs.event_id,
  min(df.user_id::text)::uuid,
  CASE
    WHEN min(df.user_id::text)::uuid = vs.participant_1_id THEN vs.participant_2_id
    ELSE vs.participant_1_id
  END,
  min(df.created_at),
  now(),
  min(df.created_at) + interval '5 minutes',
  CASE WHEN min(df.created_at) < now() - interval '24 hours' THEN now() ELSE NULL END,
  CASE WHEN min(df.created_at) < now() - interval '24 hours' THEN 'stale' ELSE 'pending' END,
  now(),
  now()
FROM public.video_sessions vs
JOIN public.date_feedback df ON df.session_id = vs.id
WHERE vs.ended_at IS NOT NULL
  AND vs.date_started_at IS NOT NULL
  AND df.user_id IN (vs.participant_1_id, vs.participant_2_id)
GROUP BY vs.id, vs.event_id, vs.participant_1_id, vs.participant_2_id
HAVING count(DISTINCT df.user_id) = 1
ON CONFLICT (session_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_post_date_pending_verdicts_stale(
  p_older_than interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    WITH stale AS (
      SELECT pd.session_id
      FROM public.post_date_pending_verdicts pd
      WHERE pd.completed_at IS NULL
        AND pd.stale_at IS NULL
        AND pd.first_detected_at < now() - COALESCE(p_older_than, interval '24 hours')
      ORDER BY pd.first_detected_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
      FOR UPDATE SKIP LOCKED
    ),
    updated AS (
      UPDATE public.post_date_pending_verdicts pd
      SET
        stale_at = now(),
        status = 'stale',
        updated_at = now()
      FROM stale
      WHERE pd.session_id = stale.session_id
      RETURNING pd.session_id, pd.event_id, pd.submitted_by, pd.missing_user_id, pd.first_detected_at
    )
    SELECT * FROM updated
  LOOP
    PERFORM public.record_event_loop_observability(
      'post_date_pending_verdict_stale',
      'success',
      'partner_verdict_missing',
      NULL,
      r.event_id,
      r.missing_user_id,
      r.session_id,
      jsonb_build_object(
        'submitted_by', r.submitted_by,
        'first_detected_at', r.first_detected_at
      )
    );
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_post_date_pending_verdicts_stale(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_post_date_pending_verdicts_stale(interval, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_post_date_pending_verdict_reminders(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  session_id uuid,
  event_id uuid,
  submitted_by uuid,
  missing_user_id uuid,
  first_detected_at timestamptz,
  reminder_sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT pd.session_id
    FROM public.post_date_pending_verdicts pd
    JOIN public.video_sessions vs ON vs.id = pd.session_id
    WHERE pd.completed_at IS NULL
      AND pd.stale_at IS NULL
      AND pd.reminder_sent_at IS NULL
      AND pd.reminder_eligible_at <= now()
      AND EXISTS (
        SELECT 1
        FROM public.date_feedback df
        WHERE df.session_id = pd.session_id
          AND df.user_id = pd.submitted_by
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df
        WHERE df.session_id = pd.session_id
          AND df.user_id = pd.missing_user_id
      )
      AND NOT public.is_blocked(pd.submitted_by, pd.missing_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = pd.submitted_by AND ur.reported_id = pd.missing_user_id)
           OR (ur.reporter_id = pd.missing_user_id AND ur.reported_id = pd.submitted_by)
      )
      AND vs.ended_at IS NOT NULL
      AND vs.date_started_at IS NOT NULL
    ORDER BY pd.first_detected_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    FOR UPDATE OF pd SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.post_date_pending_verdicts pd
    SET
      reminder_sent_at = now(),
      reminder_error = NULL,
      status = 'reminded',
      updated_at = now()
    FROM candidates
    WHERE pd.session_id = candidates.session_id
    RETURNING
      pd.session_id,
      pd.event_id,
      pd.submitted_by,
      pd.missing_user_id,
      pd.first_detected_at,
      pd.reminder_sent_at
  )
  SELECT
    claimed.session_id,
    claimed.event_id,
    claimed.submitted_by,
    claimed.missing_user_id,
    claimed.first_detected_at,
    claimed.reminder_sent_at
  FROM claimed;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_post_date_pending_verdict_reminder_result(
  p_session_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.post_date_pending_verdicts
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'pending_verdict_not_found');
  END IF;

  UPDATE public.post_date_pending_verdicts
  SET
    reminder_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'reminder_failed'), 500) END,
    updated_at = now()
  WHERE session_id = p_session_id;

  PERFORM public.record_event_loop_observability(
    CASE WHEN p_success
      THEN 'post_date_pending_verdict_reminder_sent'
      ELSE 'post_date_pending_verdict_reminder_failed'
    END,
    CASE WHEN p_success THEN 'success' ELSE 'error' END,
    CASE WHEN p_success THEN 'notified_missing_partner' ELSE 'notification_failed' END,
    NULL,
    v_row.event_id,
    v_row.missing_user_id,
    v_row.session_id,
    jsonb_build_object(
      'error', CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'reminder_failed'), 160) END
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_post_date_pending_verdict_reminder_result(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_post_date_pending_verdict_reminder_result(uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.detect_post_date_half_verdict_timeouts(
  p_older_than interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mark_post_date_pending_verdicts_stale(p_older_than, p_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.ended_at IS NULL
     OR v_session.date_started_at IS NULL
     OR COALESCE(v_session.ended_reason, '') IN (
       'ready_gate_forfeit',
       'ready_gate_expired',
       'queued_ttl_expired',
       'handshake_not_mutual',
       'handshake_grace_expired',
       'handshake_timeout',
       'blocked_pair'
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'mutual', false
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
       OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutual', false,
      'reported_pair', true
    );
  END IF;

  SELECT liked INTO v_user1_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_1_id;

  SELECT liked INTO v_user2_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_2_id;

  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
    v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    SELECT id INTO v_existing_match
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2;

    IF v_existing_match IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_p1, v_p2, v_session.event_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      END IF;

      SELECT id INTO v_existing_match
      FROM public.matches
      WHERE profile_id_1 = v_p1
        AND profile_id_2 = v_p2;

      RETURN jsonb_build_object(
        'success', true,
        'mutual', true,
        'match_id', v_existing_match,
        'already_matched', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'mutual', true,
      'match_id', v_existing_match,
      'already_matched', true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_target uuid;
  v_inner jsonb;
  v_persistent_created boolean;
  v_partner_verdict_recorded boolean := false;
  v_mutual boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    v_target := v_session.participant_2_id;
  ELSE
    v_target := v_session.participant_1_id;
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_uid, v_target) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'blocked', true
    );
  END IF;

  IF v_session.ended_at IS NULL
     OR v_session.date_started_at IS NULL
     OR COALESCE(v_session.ended_reason, '') IN (
       'ready_gate_forfeit',
       'ready_gate_expired',
       'queued_ttl_expired',
       'handshake_not_mutual',
       'handshake_grace_expired',
       'handshake_timeout',
       'blocked_pair'
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'verdict_recorded', false
    );
  END IF;

  INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
  VALUES (p_session_id, v_uid, v_target, p_liked)
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET
    liked = EXCLUDED.liked,
    target_id = EXCLUDED.target_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id = v_target
  ) INTO v_partner_verdict_recorded;

  v_inner := public.check_mutual_vibe_and_match(p_session_id);
  v_mutual := COALESCE((v_inner->>'mutual')::boolean, false);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object(
      'verdict_recorded', true,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
  END IF;

  v_persistent_created := NULL;
  IF v_mutual THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  IF NOT v_partner_verdict_recorded THEN
    INSERT INTO public.post_date_pending_verdicts (
      session_id,
      event_id,
      submitted_by,
      missing_user_id,
      first_detected_at,
      last_seen_at,
      reminder_eligible_at,
      created_at,
      updated_at,
      status
    )
    VALUES (
      p_session_id,
      v_session.event_id,
      v_uid,
      v_target,
      now(),
      now(),
      now() + interval '5 minutes',
      now(),
      now(),
      'pending'
    )
    ON CONFLICT (session_id) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      submitted_by = EXCLUDED.submitted_by,
      missing_user_id = EXCLUDED.missing_user_id,
      last_seen_at = now(),
      reminder_eligible_at = CASE
        WHEN public.post_date_pending_verdicts.reminder_sent_at IS NULL
          THEN LEAST(public.post_date_pending_verdicts.reminder_eligible_at, EXCLUDED.reminder_eligible_at)
        ELSE public.post_date_pending_verdicts.reminder_eligible_at
      END,
      completed_at = NULL,
      status = CASE
        WHEN public.post_date_pending_verdicts.stale_at IS NOT NULL THEN 'stale'
        WHEN public.post_date_pending_verdicts.reminder_sent_at IS NOT NULL THEN 'reminded'
        ELSE 'pending'
      END,
      updated_at = now();

    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_saved',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_pending',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
  ELSE
    UPDATE public.post_date_pending_verdicts
    SET
      completed_at = COALESCE(completed_at, now()),
      status = 'completed',
      updated_at = now()
    WHERE session_id = p_session_id
      AND completed_at IS NULL;

    PERFORM public.record_event_loop_observability(
      'post_date_pending_verdict_completed',
      'success',
      CASE WHEN v_mutual THEN 'mutual' ELSE 'not_mutual' END,
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'target_id', v_target,
        'mutual', v_mutual,
        'persistent_match_created', v_persistent_created
      )
    );
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON TABLE public.post_date_pending_verdicts IS
  'Server-owned tracker for one-sided post-date verdicts: one neutral reminder, stale marker, and operator visibility. date_feedback remains verdict truth.';

COMMENT ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) IS
  'Service-role-only: atomically claims eligible one-sided post-date verdict reminders and marks reminder_sent_at before Edge delivery to prevent repeat pushes.';

COMMENT ON FUNCTION public.mark_post_date_pending_verdicts_stale(interval, integer) IS
  'Service-role-only: marks pending post-date verdict reminders stale after the configured age and emits observability.';

COMMENT ON FUNCTION public.record_post_date_pending_verdict_reminder_result(uuid, boolean, text) IS
  'Service-role-only: records notification delivery result for a claimed pending post-date verdict reminder.';

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records one verdict immediately, tracks pending partner reminder/stale state, emits pending/completed observability, and only creates persistent matches when both verdicts warrant it.';

COMMENT ON FUNCTION public.check_mutual_vibe_and_match(uuid) IS
  'Post-date mutuality check: creates normalized persistent match idempotently only when both users liked and the pair is neither blocked nor reported.';

-- Optional pg_cron + pg_net worker schedule. Prefer Vault secrets when present,
-- with the same app.supabase_url/app.cron_secret fallback used by existing
-- cleanup workers. If neither secret source exists, the function can still be
-- invoked by an external scheduler with CRON_SECRET.
DO $$
DECLARE
  v_job_id integer;
  v_project_url text;
  v_cron_secret text;
  v_has_vault boolean := false;
  v_use_vault boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    v_has_vault := EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
    );

    IF v_has_vault THEN
      SELECT trim(decrypted_secret) INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT trim(decrypted_secret) INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_secret'
      LIMIT 1;

      v_use_vault := NULLIF(v_project_url, '') IS NOT NULL
        AND NULLIF(v_cron_secret, '') IS NOT NULL;
    END IF;

    v_project_url := COALESCE(NULLIF(v_project_url, ''), NULLIF(trim(current_setting('app.supabase_url', true)), ''));
    v_cron_secret := COALESCE(NULLIF(v_cron_secret, ''), NULLIF(trim(current_setting('app.cron_secret', true)), ''));

    IF v_project_url IS NOT NULL AND v_cron_secret IS NOT NULL THEN
      SELECT jobid INTO v_job_id
      FROM cron.job
      WHERE jobname = 'post-date-verdict-reminders'
      LIMIT 1;

      IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
      END IF;

      IF v_use_vault THEN
        PERFORM cron.schedule(
          'post-date-verdict-reminders',
          '*/5 * * * *',
          $cmd$
          SELECT net.http_post(
            url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
              || '/functions/v1/post-date-verdict-reminders',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
            ),
            body := '{}'::jsonb
          );
          $cmd$
        );
      ELSE
        PERFORM cron.schedule(
          'post-date-verdict-reminders',
          '*/5 * * * *',
          $cmd$
          SELECT net.http_post(
            url := nullif(trim(current_setting('app.supabase_url', true)), '')
              || '/functions/v1/post-date-verdict-reminders',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || coalesce(nullif(trim(current_setting('app.cron_secret', true)), ''), '')
            ),
            body := '{}'::jsonb
          );
          $cmd$
        );
      END IF;
    ELSE
      RAISE NOTICE 'post-date-verdict-reminders cron not scheduled: missing project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'post-date-verdict-reminders cron not scheduled: %', SQLERRM;
END $$;
