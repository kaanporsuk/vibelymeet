-- Corrective idempotent backfill for already-ended, survey-eligible video
-- dates whose Daily room metadata remained null after the helper-loop
-- migration runner path. Runtime repairs still use
-- video_date_restore_canonical_room_metadata_v1; this migration makes the
-- existing cloud rows explicit and auditable.

WITH daily_domain AS (
  SELECT COALESCE(
    NULLIF(btrim(current_setting('app.daily_domain', true)), ''),
    (
      SELECT substring(vs_domain.daily_room_url from '^https?://([^/]+)/')
      FROM public.video_sessions vs_domain
      WHERE vs_domain.daily_room_url LIKE 'http%://%/date-%'
      ORDER BY vs_domain.state_updated_at DESC NULLS LAST
      LIMIT 1
    ),
    'vibelyapp.daily.co'
  ) AS domain
)
UPDATE public.video_sessions vs
SET
  daily_room_name = 'date-' || replace(vs.id::text, '-', ''),
  daily_room_url = 'https://' || daily_domain.domain || '/' || ('date-' || replace(vs.id::text, '-', '')),
  daily_room_provider_verify_reason = CASE
    WHEN vs.daily_room_provider_verify_reason IS NULL THEN
      'canonical_room_metadata_recovered'
    WHEN vs.daily_room_provider_verify_reason = 'outbox_drainer_v2' THEN
      'canonical_room_metadata_recovered_after_outbox_drainer_v2'
    ELSE
      vs.daily_room_provider_verify_reason
  END
FROM daily_domain
WHERE vs.ended_at IS NOT NULL
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
  AND (
    vs.daily_room_name IS NULL
    OR vs.daily_room_url IS NULL
    OR vs.daily_room_name IS DISTINCT FROM ('date-' || replace(vs.id::text, '-', ''))
    OR COALESCE(vs.daily_room_url, '') NOT LIKE ('%/' || ('date-' || replace(vs.id::text, '-', '')))
  );
