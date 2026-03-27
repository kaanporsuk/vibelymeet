-- Outbound chat idempotency: one message per (match, client_request_id) for non–vibe_game rows.
-- Vibe Arcade keeps its own partial unique index on the same JSON path when message_kind = 'vibe_game'.

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_outbound_client_request_id
ON public.messages (match_id, (btrim(structured_payload->>'client_request_id')))
WHERE structured_payload IS NOT NULL
  AND structured_payload->>'client_request_id' IS NOT NULL
  AND length(btrim(structured_payload->>'client_request_id')) > 0
  AND (message_kind IS DISTINCT FROM 'vibe_game');
