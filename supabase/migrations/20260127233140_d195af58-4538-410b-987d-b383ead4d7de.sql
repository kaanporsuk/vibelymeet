-- Fix infinite recursion in profiles RLS by using a security definer function
-- The current policy references profiles table within itself causing recursion

-- First, drop the problematic policy
DROP POLICY IF EXISTS "Users can view potential matches for Daily Drop" ON public.profiles;

-- Create security definer function to check if a user matches gender preferences
-- This function runs with elevated privileges, bypassing RLS to avoid recursion
CREATE OR REPLACE FUNCTION public.check_gender_compatibility(_viewer_id uuid, _target_gender text, _target_interested_in text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Check if viewer is interested in target's gender
    EXISTS (
      SELECT 1 FROM public.profiles AS viewer
      WHERE viewer.id = _viewer_id
      AND (
        viewer.interested_in IS NULL 
        OR cardinality(viewer.interested_in) = 0
        OR _target_gender = ANY(viewer.interested_in)
      )
    )
    -- AND target is interested in viewer's gender (bidirectional)
    AND (
      _target_interested_in IS NULL 
      OR cardinality(_target_interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles AS viewer
        WHERE viewer.id = _viewer_id
        AND viewer.gender = ANY(_target_interested_in)
      )
    )
  )
$$;

-- Re-create the policy using the security definer function
-- This avoids recursion by not directly querying profiles in the policy itself
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
  -- Use security definer function to check gender compatibility
  public.check_gender_compatibility(auth.uid(), gender, interested_in)
);