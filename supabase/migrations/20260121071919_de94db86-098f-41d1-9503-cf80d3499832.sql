-- Fix Security Issue 1: profile_vibes_public_exposure
-- Remove the public SELECT policy that allows anyone to view profile vibes
DROP POLICY IF EXISTS "Anyone can view profile vibes" ON public.profile_vibes;

-- Fix Security Issue 2: event_registrations_public_exposure  
-- Remove the public SELECT policy that allows anyone to view event registrations
DROP POLICY IF EXISTS "Anyone can view registrations" ON public.event_registrations;

-- Add authenticated policy for event registrations: users can view registrations for events they're registered to
CREATE POLICY "Users can view registrations for shared events"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  EXISTS (
    SELECT 1 FROM public.event_registrations er
    WHERE er.event_id = event_registrations.event_id
    AND er.profile_id = auth.uid()
  )
);