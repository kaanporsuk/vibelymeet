-- Index for message bundling query in send-notification edge function
-- NOTE: superseded by 20260322190000 which corrected the index definition.
-- This migration is kept for migration history only.

-- Original (superseded — had redundant read_at column):
-- CREATE INDEX IF NOT EXISTS idx_messages_match_unread
--   ON public.messages (match_id, read_at)
--   WHERE read_at IS NULL;

-- Correct version is in 20260322190000_fix_messages_bundling_index.sql:
-- CREATE INDEX IF NOT EXISTS idx_messages_match_unread
--   ON public.messages (match_id, sender_id)
--   WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_match_id
  ON public.messages (match_id);
