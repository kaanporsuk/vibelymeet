-- Repair the survey feedback drain guard helper after linked DB lint caught
-- an invalid fallback order column. `video_sessions` has `started_at`, not
-- `created_at`; keep the public helper signature stable and replace only the
-- final helper body.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_actor_pending_feedback_gate_v1(
  p_event_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_pending record;
  v_path text;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'success', true, 'blocked', false);
  END IF;

  SELECT
    vs.id AS session_id,
    vs.event_id,
    partner.partner_id,
    er.id AS registration_id,
    er.queue_status,
    vs.ended_at,
    vs.ended_reason
  INTO v_pending
  FROM public.video_sessions vs
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN vs.participant_1_id = v_actor THEN vs.participant_2_id
      WHEN vs.participant_2_id = v_actor THEN vs.participant_1_id
      ELSE NULL::uuid
    END AS partner_id
  ) partner
  LEFT JOIN public.event_registrations er
    ON er.event_id = vs.event_id
   AND er.profile_id = v_actor
  WHERE vs.event_id = p_event_id
    AND partner.partner_id IS NOT NULL
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
      FROM public.date_feedback df
      WHERE df.session_id = vs.id
        AND df.user_id = v_actor
    )
    AND NOT public.is_blocked(v_actor, partner.partner_id)
    AND NOT public.is_blocked(partner.partner_id, v_actor)
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_actor AND ur.reported_id = partner.partner_id)
         OR (ur.reporter_id = partner.partner_id AND ur.reported_id = v_actor)
    )
  ORDER BY
    COALESCE(vs.ended_at, vs.state_updated_at, vs.started_at) DESC,
    vs.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'success', true, 'blocked', false);
  END IF;

  v_path := '/date/' || v_pending.session_id::text;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'found', false,
    'queued', false,
    'blocked', true,
    'reason', 'pending_post_date_feedback',
    'code', 'PENDING_POST_DATE_FEEDBACK',
    'error_code', 'PENDING_POST_DATE_FEEDBACK',
    'retryable', false,
    'session_id', v_pending.session_id,
    'video_session_id', v_pending.session_id,
    'event_id', v_pending.event_id,
    'partner_id', v_pending.partner_id,
    'route', v_path,
    'path', v_path,
    'next_surface', jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'path', v_path,
      'session_id', v_pending.session_id,
      'event_id', v_pending.event_id,
      'target_id', v_pending.partner_id,
      'reason', 'pending_post_date_feedback'
    ),
    'feedback_gate', jsonb_build_object(
      'registration_id', v_pending.registration_id,
      'queue_status', v_pending.queue_status,
      'ended_at', v_pending.ended_at,
      'ended_reason', v_pending.ended_reason
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid) IS
  'Service-only Video Date queue-drain guard. Returns pending_post_date_feedback when the actor has any same-event survey-eligible ended session without their date_feedback row.';

COMMIT;
