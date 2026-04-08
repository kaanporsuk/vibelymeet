-- Fix recursive authenticated-read RLS between event_registrations, profiles, and profile_vibes.
-- Preserve existing product semantics:
-- - users can always see their own registration row
-- - confirmed attendees can see registration rows for their event cohort
-- - users can see profiles/profile_vibes for people who share an event registration

CREATE OR REPLACE FUNCTION public.viewer_shares_event_with_profile(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations viewer_reg
      JOIN public.event_registrations other_reg
        ON other_reg.event_id = viewer_reg.event_id
      WHERE viewer_reg.profile_id = auth.uid()
        AND other_reg.profile_id = p_other_profile_id
    );
$$;

COMMENT ON FUNCTION public.viewer_shares_event_with_profile(uuid) IS
'RLS helper for event co-attendee visibility. Evaluates shared-event access without recursing through event_registrations row policies.';

DROP POLICY IF EXISTS "Users can view registrations for shared events" ON public.event_registrations;
CREATE POLICY "Users can view registrations for shared events"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND (
    auth.uid() = profile_id
    OR public.is_registered_for_event(auth.uid(), event_id)
  )
);

DROP POLICY IF EXISTS "Users can view event participant profiles" ON public.profiles;
CREATE POLICY "Users can view event participant profiles"
ON public.profiles
FOR SELECT
USING (public.viewer_shares_event_with_profile(id));

DROP POLICY IF EXISTS "Users can view event participants profile vibes" ON public.profile_vibes;
CREATE POLICY "Users can view event participants profile vibes"
ON public.profile_vibes
FOR SELECT
USING (public.viewer_shares_event_with_profile(profile_id));
