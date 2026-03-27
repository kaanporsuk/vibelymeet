-- Vibe Clips: add 'vibe_clip' to the messages.message_kind CHECK constraint.
--
-- Contract:
--   message_kind = 'vibe_clip'
--   video_url    = Bunny CDN URL (from upload-chat-video EF)
--   video_duration_seconds = integer
--   structured_payload = {
--     "v": 2,
--     "kind": "vibe_clip",
--     "client_request_id": "<uuid>",
--     "duration_ms": <integer>,
--     "thumbnail_url": <string|null>,
--     "processing_status": "ready",
--     "upload_provider": "bunny"
--   }
--
-- Legacy video messages (message_kind='text', video_url IS NOT NULL) remain
-- fully supported and are not migrated by this change.

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
      'vibe_clip'
    )
  );

COMMENT ON COLUMN public.messages.message_kind IS
  'text | date_suggestion | date_suggestion_event | vibe_game | vibe_clip; vibe_clip uses structured_payload v2 with clip metadata.';
