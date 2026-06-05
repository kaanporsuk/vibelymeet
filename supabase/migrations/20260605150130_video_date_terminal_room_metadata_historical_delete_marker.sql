-- Mark terminal rows previously repaired after old outbox cleanup so scheduled
-- cleanup workers do not keep polling provider state for already-deleted rooms.

UPDATE public.video_sessions vs
SET
  daily_room_provider_deleted_at = now(),
  daily_room_provider_delete_reason = 'historical_outbox_drainer_v2_metadata_repair'
WHERE vs.ended_at IS NOT NULL
  AND vs.daily_room_provider_deleted_at IS NULL
  AND vs.daily_room_provider_verify_reason = 'canonical_room_metadata_recovered_after_outbox_drainer_v2'
  AND vs.daily_room_name IS NOT NULL
  AND vs.daily_room_url IS NOT NULL
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
  );
