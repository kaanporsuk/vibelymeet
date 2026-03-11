-- Allow anonymous read for chat-videos so browser <video> playback works.
-- The public URL is loaded without a JWT; existing policy only allowed authenticated SELECT.
-- Write permissions (INSERT) remain restricted to authenticated users in their matches.
-- Fixes: "Video unavailable" after sending chat video (upload succeeds, playback 403).

CREATE POLICY "Anon can view chat videos for playback"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'chat-videos');
