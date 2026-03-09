
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-videos', 'chat-videos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload chat videos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-videos' AND (storage.foldername(name))[1] IN (
  SELECT id::text FROM public.matches 
  WHERE profile_id_1 = auth.uid() OR profile_id_2 = auth.uid()
));

CREATE POLICY "Anyone can view chat videos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-videos');
