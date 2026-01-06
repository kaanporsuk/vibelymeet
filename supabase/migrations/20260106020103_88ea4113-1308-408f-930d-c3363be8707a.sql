-- Create storage bucket for vibe videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('vibe-videos', 'vibe-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for vibe-videos bucket
-- Allow authenticated users to upload their own videos
CREATE POLICY "Users can upload their own vibe videos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to update their own videos
CREATE POLICY "Users can update their own vibe videos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to delete their own videos
CREATE POLICY "Users can delete their own vibe videos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vibe-videos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow anyone to view vibe videos (public bucket)
CREATE POLICY "Vibe videos are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'vibe-videos');