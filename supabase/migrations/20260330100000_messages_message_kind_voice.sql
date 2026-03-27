-- Server-owned voice messages: allow message_kind = 'voice' for rows created via send-message.
-- Historical voice rows may remain message_kind = 'text' with audio_url; renderers use inferChatMediaRenderKind.

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
      'vibe_game',
      'vibe_clip',
      'voice'
    )
  );

COMMENT ON COLUMN public.messages.message_kind IS
  'text | date_suggestion | date_suggestion_event | vibe_game | vibe_clip | voice; voice = chat voice note via send-message; legacy voice may still be text+audio_url.';
