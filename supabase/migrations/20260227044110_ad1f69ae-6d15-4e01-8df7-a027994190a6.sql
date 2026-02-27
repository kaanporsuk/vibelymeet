-- Add referred_by column for referral tracking
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID;
