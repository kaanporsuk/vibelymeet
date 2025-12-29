-- Add photo_verified column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS photo_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS photo_verified_at timestamptz,
ADD COLUMN IF NOT EXISTS proof_selfie_url text;

-- Create private storage bucket for proof selfies
INSERT INTO storage.buckets (id, name, public)
VALUES ('proof-selfies', 'proof-selfies', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for proof-selfies bucket - users can only upload their own
CREATE POLICY "Users can upload their own proof selfie"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'proof-selfies' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own proof selfies
CREATE POLICY "Users can view their own proof selfie"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proof-selfies' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admins can view all proof selfies for audit
CREATE POLICY "Admins can view all proof selfies"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proof-selfies' 
  AND public.has_role(auth.uid(), 'admin')
);