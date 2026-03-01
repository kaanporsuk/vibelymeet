
ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS handshake_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS date_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'handshake';
