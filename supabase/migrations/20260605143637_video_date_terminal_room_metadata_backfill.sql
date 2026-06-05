-- Backfill terminal Daily room forensics for already-ended, survey-eligible
-- video dates whose canonical Daily metadata was lost before
-- 20260605135616_video_date_terminal_survey_lifecycle_hardening.sql.

BEGIN;

DO $$
DECLARE
  v_session_id uuid;
BEGIN
  FOR v_session_id IN
    SELECT vs.id
    FROM public.video_sessions vs
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
      )
  LOOP
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      v_session_id,
      'migration:20260605143637_terminal_room_metadata_backfill'
    );
  END LOOP;
END $$;

COMMIT;
