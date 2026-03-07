ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS bunny_video_uid TEXT,
ADD COLUMN IF NOT EXISTS bunny_video_status TEXT NOT NULL DEFAULT 'none';

COMMENT ON COLUMN profiles.bunny_video_uid IS 'Bunny Stream video GUID. Null means no video uploaded yet.';
COMMENT ON COLUMN profiles.bunny_video_status IS 'none | uploading | processing | ready | failed';