ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS video_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_duration_seconds integer DEFAULT NULL;