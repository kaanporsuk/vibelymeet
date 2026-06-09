-- Video Date pre-stable failures must not re-open terminal survey.
--
-- Migration 20260609035833 reclassifies provider-absence terminals that never
-- reached durable bilateral media as `pre_stable_media_failed` and returns
-- `survey_required=false`. Keep the shared survey eligibility helpers aligned
-- so later lifecycle-context enrichment cannot infer survey truth from stale
-- date-started/remote-seen fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible(
  p_ended_at timestamptz,
  p_ended_reason text,
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_encounter_exposure(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'handshake_grace_expired',
      'partial_join_peer_timeout',
      'peer_missing_timeout',
      'prepare_entry_daily_join_missing',
      'pre_stable_media_failed',
      'blocked_pair',
      'blocked_or_reported_pair'
    );
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_is_post_date_survey_eligible(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_session_is_post_date_survey_eligible(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  p_ended_at timestamptz,
  p_ended_reason text,
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz,
  p_participant_1_remote_seen_at timestamptz,
  p_participant_2_remote_seen_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_confirmed_encounter(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at,
      p_participant_1_remote_seen_at,
      p_participant_2_remote_seen_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'handshake_grace_expired',
      'partial_join_peer_timeout',
      'peer_missing_timeout',
      'prepare_entry_daily_join_missing',
      'pre_stable_media_failed',
      'blocked_pair',
      'blocked_or_reported_pair'
    );
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) TO service_role;

COMMENT ON FUNCTION public.video_date_session_is_post_date_survey_eligible(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz
) IS
  'Legacy post-date survey eligibility helper. Pre-stable media failures are explicitly survey-ineligible.';

COMMENT ON FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) IS
  'Confirmed-encounter survey eligibility helper. Pre-stable media failures are explicitly survey-ineligible.';

NOTIFY pgrst, 'reload schema';

COMMIT;
