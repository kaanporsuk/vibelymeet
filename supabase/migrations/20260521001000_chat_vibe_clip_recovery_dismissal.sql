-- Chat Vibe Clip recovery dismissal.
--
-- A user can explicitly abandon a stale unpublished foreground-recovery row
-- after choosing "Discard + send again". The upload row remains auditable, but
-- it no longer contributes to client recovery-attention surfaces.

ALTER TABLE public.chat_vibe_clip_uploads
  ADD COLUMN IF NOT EXISTS recovery_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recovery_dismissed_reason text;

CREATE INDEX IF NOT EXISTS idx_chat_vibe_clip_uploads_recovery_attention
  ON public.chat_vibe_clip_uploads (sender_id, updated_at ASC)
  WHERE published_message_id IS NULL
    AND recovery_dismissed_at IS NULL
    AND status IN ('uploading', 'processing', 'failed');

COMMENT ON COLUMN public.chat_vibe_clip_uploads.recovery_dismissed_at IS
  'Set when the sender explicitly dismisses an unpublished recovery row from foreground upload recovery UX.';

COMMENT ON COLUMN public.chat_vibe_clip_uploads.recovery_dismissed_by IS
  'Authenticated sender who dismissed the unpublished recovery row.';

COMMENT ON COLUMN public.chat_vibe_clip_uploads.recovery_dismissed_reason IS
  'Code-owned reason for dismissing the unpublished recovery row.';
