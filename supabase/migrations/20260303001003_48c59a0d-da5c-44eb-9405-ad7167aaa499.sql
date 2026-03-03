
-- Photo Verifications table for admin review pipeline
CREATE TABLE public.photo_verifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  selfie_url TEXT NOT NULL,
  profile_photo_url TEXT NOT NULL,
  client_confidence_score INTEGER,
  client_match_result BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '180 days')
);

ALTER TABLE public.photo_verifications ENABLE ROW LEVEL SECURITY;

-- Users can view own verifications
CREATE POLICY "Users can view own verifications" ON public.photo_verifications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can submit verifications
CREATE POLICY "Users can submit verifications" ON public.photo_verifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can view all verifications
CREATE POLICY "Admins can view all verifications" ON public.photo_verifications
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Indexes
CREATE INDEX idx_photo_verifications_user ON public.photo_verifications (user_id, status);
CREATE INDEX idx_photo_verifications_pending ON public.photo_verifications (status, created_at) WHERE status = 'pending';

-- Add photo_verification_expires_at to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_verification_expires_at TIMESTAMP WITH TIME ZONE;

-- Ensure phone_number unique constraint
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_phone_number_unique'
  ) THEN
    CREATE UNIQUE INDEX profiles_phone_number_unique ON public.profiles (phone_number) WHERE phone_number IS NOT NULL AND phone_verified = true;
  END IF;
END $$;
