-- Fix the current_attendees count to match actual registrations
UPDATE public.events e
SET current_attendees = (
  SELECT COUNT(*) FROM public.event_registrations 
  WHERE event_id = e.id
);