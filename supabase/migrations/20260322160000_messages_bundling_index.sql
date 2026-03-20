-- Index for message bundling query in send-notification edge function
-- Covers: .eq('match_id').is('read_at', null).neq('sender_id')

-- Drop the redundant index first (no-op on fresh installs)
DROP INDEX IF EXISTS idx_messages_match_unread;

-- Partial on read_at IS NULL; index columns (match_id, sender_id) — not redundant read_at
CREATE INDEX IF NOT EXISTS idx_messages_match_unread
  ON public.messages (match_id, sender_id)
  WHERE read_at IS NULL;

-- Plain match_id index (chat queries throughout the app)
CREATE INDEX IF NOT EXISTS idx_messages_match_id
  ON public.messages (match_id);
