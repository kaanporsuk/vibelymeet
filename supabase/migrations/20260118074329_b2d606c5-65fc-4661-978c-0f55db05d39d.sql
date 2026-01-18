-- Fix PUBLIC_DATA_EXPOSURE: profile_vibes table publicly readable
-- Drop previously created policies (from partial migration)
DROP POLICY IF EXISTS "Users can view own profile vibes" ON public.profile_vibes;
DROP POLICY IF EXISTS "Users can view matched users profile vibes" ON public.profile_vibes;
DROP POLICY IF EXISTS "Users can view event participants profile vibes" ON public.profile_vibes;
DROP POLICY IF EXISTS "Admins can view all profile vibes" ON public.profile_vibes;

-- Users can view their own profile vibes
CREATE POLICY "Users can view own profile vibes"
ON public.profile_vibes FOR SELECT
USING (auth.uid() = profile_id);

-- Users can view profile vibes of users they've matched with
CREATE POLICY "Users can view matched users profile vibes"
ON public.profile_vibes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.matches
    WHERE (profile_id_1 = auth.uid() AND profile_id_2 = profile_vibes.profile_id)
       OR (profile_id_2 = auth.uid() AND profile_id_1 = profile_vibes.profile_id)
  )
);

-- Users can view profile vibes of co-attendees at events
CREATE POLICY "Users can view event participants profile vibes"
ON public.profile_vibes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.event_registrations er1
    JOIN public.event_registrations er2 ON er1.event_id = er2.event_id
    WHERE er1.profile_id = auth.uid()
      AND er2.profile_id = profile_vibes.profile_id
  )
);

-- Admins can view all profile vibes (correct argument order: user_id, role)
CREATE POLICY "Admins can view all profile vibes"
ON public.profile_vibes FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));