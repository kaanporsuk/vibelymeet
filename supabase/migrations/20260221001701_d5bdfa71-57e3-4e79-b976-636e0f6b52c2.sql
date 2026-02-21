-- Add last_seen_at to profiles for activity tracking
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

-- Add voice message fields to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_url text DEFAULT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_duration_seconds integer DEFAULT NULL;

-- Create voice-messages storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('voice-messages', 'voice-messages', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for voice messages
CREATE POLICY "Users can upload voice messages" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'voice-messages' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Anyone can listen to voice messages" ON storage.objects FOR SELECT
USING (bucket_id = 'voice-messages');