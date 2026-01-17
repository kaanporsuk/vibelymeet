-- Add RLS policies for admins to view all profiles and data
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin policy to view all matches
CREATE POLICY "Admins can view all matches"
ON public.matches
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin policy to view all daily_drops
CREATE POLICY "Admins can view all daily_drops"
ON public.daily_drops
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin policy to view all profile_vibes
CREATE POLICY "Admins can view all profile_vibes"
ON public.profile_vibes
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin policy to view all video_sessions for interaction tracking
CREATE POLICY "Admins can view all video_sessions"
ON public.video_sessions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin policy to view all event_registrations
CREATE POLICY "Admins can view all event_registrations"
ON public.event_registrations
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));