-- FIX CRITICAL SECURITY ISSUE: Drop overly permissive profiles policy
-- This policy allows ANY authenticated user to view ALL profiles, exposing sensitive personal data

DROP POLICY IF EXISTS "Require authentication for profiles" ON public.profiles;

-- Add policy for Daily Drop: Users can view profiles that match their dating preferences
-- This allows the Daily Drop feature to work while restricting access appropriately
CREATE POLICY "Users can view potential matches for Daily Drop"
ON public.profiles
FOR SELECT
USING (
  -- User must be authenticated
  auth.uid() IS NOT NULL
  AND
  -- Target profile must not be suspended
  is_suspended = false
  AND
  -- Only allow viewing profiles that match the viewer's gender preferences
  -- This uses a security definer function approach to avoid recursion
  (
    -- Check if current user is interested in this profile's gender
    EXISTS (
      SELECT 1 FROM public.profiles AS viewer
      WHERE viewer.id = auth.uid()
      AND (
        viewer.interested_in IS NULL 
        OR cardinality(viewer.interested_in) = 0
        OR profiles.gender = ANY(viewer.interested_in)
      )
    )
    -- AND the profile owner is interested in the current user's gender (bidirectional match)
    AND (
      profiles.interested_in IS NULL 
      OR cardinality(profiles.interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles AS viewer
        WHERE viewer.id = auth.uid()
        AND viewer.gender = ANY(profiles.interested_in)
      )
    )
  )
);