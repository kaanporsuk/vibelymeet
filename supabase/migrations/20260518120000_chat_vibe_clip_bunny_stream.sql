-- Chat Vibe Clips: Bunny Stream upload session tracking.
--
-- New Chat Vibe Clips upload directly from client to Bunny Stream. Supabase
-- owns authorization, idempotency, status, message publication, and media
-- lifecycle references, but does not transport the video bytes.

CREATE TABLE IF NOT EXISTS public.chat_vibe_clip_uploads (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_request_id     uuid        NOT NULL,
  media_asset_id        uuid        REFERENCES public.media_assets(id) ON DELETE SET NULL,
  provider_object_id    text        NOT NULL,
  published_message_id  uuid        REFERENCES public.messages(id) ON DELETE SET NULL,

  duration_ms           integer     NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 30250),
  aspect_ratio          numeric,
  source_bytes          bigint      CHECK (source_bytes IS NULL OR (source_bytes > 0 AND source_bytes <= 209715200)),
  mime_type             text,

  status                text        NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  error_detail          text,
  expires_at            timestamptz NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_chat_vibe_clip_uploads_sender_client
    UNIQUE (sender_id, client_request_id),
  CONSTRAINT uq_chat_vibe_clip_uploads_provider_object
    UNIQUE (provider_object_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_vibe_clip_uploads_match
  ON public.chat_vibe_clip_uploads (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_vibe_clip_uploads_sender
  ON public.chat_vibe_clip_uploads (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_vibe_clip_uploads_message
  ON public.chat_vibe_clip_uploads (published_message_id)
  WHERE published_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_vibe_clip_uploads_status
  ON public.chat_vibe_clip_uploads (status, updated_at DESC)
  WHERE status IN ('uploading', 'processing');

CREATE OR REPLACE FUNCTION public.chat_vibe_clip_uploads_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_vibe_clip_uploads_updated_at
  ON public.chat_vibe_clip_uploads;
CREATE TRIGGER trg_chat_vibe_clip_uploads_updated_at
  BEFORE UPDATE ON public.chat_vibe_clip_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_vibe_clip_uploads_set_updated_at();

ALTER TABLE public.chat_vibe_clip_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chat vibe clip uploads"
  ON public.chat_vibe_clip_uploads FOR SELECT
  USING (auth.uid() = sender_id);

CREATE POLICY "Service role full access to chat vibe clip uploads"
  ON public.chat_vibe_clip_uploads FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE public.chat_vibe_clip_uploads IS
  'Server-owned upload/session records for Chat Vibe Clips uploaded directly to Bunny Stream.';
