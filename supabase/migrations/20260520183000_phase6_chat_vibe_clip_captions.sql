-- Phase 6 display hardening: preserve optional structured captions for Chat Vibe Clips.

ALTER TABLE public.chat_vibe_clip_uploads
  ADD COLUMN IF NOT EXISTS captions jsonb;

COMMENT ON COLUMN public.chat_vibe_clip_uploads.captions IS
  'Optional structured captions captured client-side at recording/upload time and copied into messages.structured_payload.captions for display.';

