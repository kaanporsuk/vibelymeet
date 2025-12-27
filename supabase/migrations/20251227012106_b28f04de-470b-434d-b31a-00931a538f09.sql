-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;

-- Allow viewing own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Allow viewing matched profiles
CREATE POLICY "Users can view matched profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matches
      WHERE (profile_id_1 = auth.uid() AND profile_id_2 = profiles.id)
         OR (profile_id_2 = auth.uid() AND profile_id_1 = profiles.id)
    )
  );

-- Allow viewing profiles of users registered to the same events
CREATE POLICY "Users can view event participant profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.event_registrations er1
      JOIN public.event_registrations er2 ON er1.event_id = er2.event_id
      WHERE er1.profile_id = auth.uid()
        AND er2.profile_id = profiles.id
    )
  );