-- Vibe Arcade: persisted game timeline events (structured_payload + message_kind vibe_game)

-- Drop any existing CHECK on messages.message_kind (name varies by PG version)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'messages'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%message_kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_kind_check
  CHECK (
    message_kind IN (
      'text',
      'date_suggestion',
      'date_suggestion_event',
      'vibe_game'
    )
  );

COMMENT ON COLUMN public.messages.message_kind IS
  'text | date_suggestion | date_suggestion_event | vibe_game; vibe_game uses structured_payload (schema vibely.game_event).';

-- One row per (match, game_session_id, event_index) — enforces ordering + idempotency on retries with same index
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_vibe_game_session_event
ON public.messages (
  match_id,
  (structured_payload->>'game_session_id'),
  ((structured_payload->>'event_index')::integer)
)
WHERE message_kind = 'vibe_game'
  AND structured_payload->>'game_session_id' IS NOT NULL
  AND structured_payload->>'event_index' IS NOT NULL;

-- Optional client idempotency key (UUID string), scoped per match
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_vibe_game_client_request
ON public.messages (match_id, (structured_payload->>'client_request_id'))
WHERE message_kind = 'vibe_game'
  AND structured_payload->>'client_request_id' IS NOT NULL
  AND length(btrim(structured_payload->>'client_request_id')) > 0;
