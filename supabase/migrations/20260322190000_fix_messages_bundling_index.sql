-- Fix: remove redundant read_at column from partial index,
-- add sender_id to better support bundling query predicate
DROP INDEX IF EXISTS public.idx_messages_match_unread;

CREATE INDEX IF NOT EXISTS idx_messages_match_unread
  ON public.messages (match_id, sender_id)
  WHERE read_at IS NULL;
