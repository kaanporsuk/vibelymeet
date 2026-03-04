-- Bug 5: Allow all authenticated users to view vibe video intros
CREATE POLICY "Authenticated users can view vibe video intros"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'vibe-videos'
  AND (name NOT LIKE 'moderation/%')
  AND (name NOT LIKE 'admin-review/%')
  AND (name NOT LIKE 'private/%')
  AND (name NOT LIKE 'flagged/%')
);

-- Bug 7: Add vibe_caption and vibe_video_status columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vibe_caption text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vibe_video_status text;