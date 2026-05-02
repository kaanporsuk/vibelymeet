-- Video Date survey continuity cleanup.
--
-- Keeps date_started_at reserved for the mutual date phase, while using the
-- established-encounter helper (date phase OR both Daily joins) for post-date
-- survey, pending-verdict reminder, and terminal registration routing.

CREATE INDEX IF NOT EXISTS idx_video_sessions_p1_ended_encounter_survey_lookup
  ON public.video_sessions (participant_1_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR state = 'date'::public.video_date_state
      OR phase = 'date'
      OR (participant_1_joined_at IS NOT NULL AND participant_2_joined_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_video_sessions_p2_ended_encounter_survey_lookup
  ON public.video_sessions (participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR state = 'date'::public.video_date_state
      OR phase = 'date'
      OR (participant_1_joined_at IS NOT NULL AND participant_2_joined_at IS NOT NULL)
    );

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
WHERE public.video_date_session_is_post_date_survey_eligible(
    vs.ended_at,
    vs.ended_reason,
    vs.date_started_at,
    vs.state::text,
    vs.phase,
    vs.participant_1_joined_at,
    vs.participant_2_joined_at
  )
  AND df.user_id IN (vs.participant_1_id, vs.participant_2_id)
GROUP BY vs.id, vs.event_id, vs.participant_1_id, vs.participant_2_id
HAVING count(DISTINCT df.user_id) = 1
ON CONFLICT (session_id) DO NOTHING;

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
      AND public.video_date_session_is_post_date_survey_eligible(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at
      )
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

COMMENT ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) IS
  'Claims due one-sided post-date verdict reminders for any survey-eligible established encounter, including both-joined warm-up endings without date_started_at.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260503110000_survey_continuity_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260503110000_survey_continuity_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260503110000_survey_continuity_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260503110000_survey_continuity_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_should_open_survey boolean := false;
BEGIN
  v_result := public.video_date_transition_20260503110000_survey_continuity_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at
      );

      IF v_should_open_survey THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
            ELSE v_session.participant_1_id
          END,
          last_active_at = now()
        WHERE event_id = v_session.event_id
          AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          'terminal_encounter_survey_continuity_applied',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', p_action,
            'reason', p_reason,
            'ended_reason', v_session.ended_reason,
            'date_started_at', v_session.date_started_at,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'survey_required', true
          )
        );
      END IF;
    END IF;

    RETURN v_result || jsonb_build_object('survey_required', v_should_open_survey);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. Preserves post-date survey routing for every terminal established encounter, including both-joined warm-up endings without date_started_at.';
