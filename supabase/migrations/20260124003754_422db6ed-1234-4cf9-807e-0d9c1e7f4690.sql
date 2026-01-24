-- Fix 1: Add authentication requirement policy for profiles table
-- This ensures only authenticated users can view profiles (combined with existing specific policies)
CREATE POLICY "Require authentication for profiles"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Fix 2: Add RLS policies for verification_attempts table
-- Only service role should access this (for edge functions), but we add user-own-data policy as backup
CREATE POLICY "Users can view own verification attempts"
ON public.verification_attempts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Service role manages verification attempts"
ON public.verification_attempts
FOR ALL
USING (auth.role() = 'service_role');

-- Fix 3: Update matches SELECT policy to check blocking in both directions
-- First drop the existing policy
DROP POLICY IF EXISTS "Users can view own matches" ON public.matches;

-- Create updated policy with proper bidirectional blocking check
CREATE POLICY "Users can view own matches"
ON public.matches
FOR SELECT
USING (
  ((auth.uid() = profile_id_1) OR (auth.uid() = profile_id_2))
  AND NOT is_blocked(profile_id_1, profile_id_2)
  AND NOT is_blocked(profile_id_2, profile_id_1)
);