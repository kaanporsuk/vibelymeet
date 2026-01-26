-- Create a security definer function to check if a user is registered for an event
-- This avoids infinite recursion in RLS policies
CREATE OR REPLACE FUNCTION public.is_registered_for_event(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE profile_id = _user_id
      AND event_id = _event_id
  )
$$;

-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "Users can view registrations for shared events" ON public.event_registrations;

-- Create a new policy using the security definer function
CREATE POLICY "Users can view registrations for shared events"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL 
  AND public.is_registered_for_event(auth.uid(), event_id)
);