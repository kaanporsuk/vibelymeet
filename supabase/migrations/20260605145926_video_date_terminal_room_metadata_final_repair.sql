-- Final repair after deploying cleanup workers that preserve terminal room
-- metadata. Existing rows re-nullified by the old outbox drainer are restored
-- and marked provider-deleted so new cleanup workers do not reprocess them.

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
  END,
  daily_room_provider_deleted_at = CASE
    WHEN vs.daily_room_provider_deleted_at IS NULL
      AND vs.daily_room_provider_verify_reason = 'outbox_drainer_v2' THEN now()
    ELSE vs.daily_room_provider_deleted_at
  END,
  daily_room_provider_delete_reason = CASE
    WHEN vs.daily_room_provider_deleted_at IS NULL
      AND vs.daily_room_provider_verify_reason = 'outbox_drainer_v2' THEN
      'historical_outbox_drainer_v2_metadata_repair'
    ELSE vs.daily_room_provider_delete_reason
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
