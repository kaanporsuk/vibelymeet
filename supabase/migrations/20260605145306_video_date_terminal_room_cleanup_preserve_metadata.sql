-- Preserve canonical Daily room metadata after provider cleanup.
--
-- Historical cleanup workers used `daily_room_name = null` / `daily_room_url = null`
-- as the "provider room deleted" marker. That erased terminal forensics and caused
-- post-fix backfills to be re-nullified. Track provider deletion separately.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS daily_room_provider_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_room_provider_delete_reason text;

COMMENT ON COLUMN public.video_sessions.daily_room_provider_deleted_at IS
  'Time the Daily provider room was deleted for this video date. Does not clear canonical room metadata.';

COMMENT ON COLUMN public.video_sessions.daily_room_provider_delete_reason IS
  'Bounded operational reason/source for Daily provider room deletion while preserving room metadata.';

CREATE INDEX IF NOT EXISTS idx_video_sessions_terminal_room_cleanup_pending
  ON public.video_sessions (ended_at)
  WHERE ended_at IS NOT NULL
    AND daily_room_name IS NOT NULL
    AND daily_room_provider_deleted_at IS NULL;
