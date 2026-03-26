-- Native chat outbox idempotency: allow clients to provide a durable client_request_id token
-- for all normal chat messages (text + media) without impacting date/game message kinds.
--
-- We scope to message_kind IS NULL OR 'text' to avoid interfering with:
-- - vibe_game (already has its own unique client_request index)
-- - date_suggestion / date_suggestion_event (ref_id-based)

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_chat_client_request
ON public.messages (match_id, (structured_payload->>'client_request_id'))
WHERE (message_kind IS NULL OR message_kind = 'text')
  AND structured_payload->>'client_request_id' IS NOT NULL
  AND length(btrim(structured_payload->>'client_request_id')) > 0;

