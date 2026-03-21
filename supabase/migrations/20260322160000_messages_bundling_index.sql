-- Indexes for message bundling query in send-notification edge function.
--
-- idx_messages_match_unread was superseded by 20260322190000 which
-- corrected the index to (match_id, sender_id) WHERE read_at IS NULL.
-- That index is created in 20260322190000, not here.
--
-- idx_messages_match_id is created here and is still active.
-- It supports general match-based chat queries throughout the app.

CREATE INDEX IF NOT EXISTS idx_messages_match_id
  ON public.messages (match_id);
