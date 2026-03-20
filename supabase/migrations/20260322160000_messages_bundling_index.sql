-- Index for message bundling query in send-notification edge function
-- Covers: .eq('match_id').is('read_at', null).neq('sender_id')
CREATE INDEX IF NOT EXISTS idx_messages_match_unread
  ON public.messages (match_id, read_at)
  WHERE read_at IS NULL;

-- Also add a plain match_id index if not already present
-- (used by chat queries throughout the app)
CREATE INDEX IF NOT EXISTS idx_messages_match_id
  ON public.messages (match_id);
