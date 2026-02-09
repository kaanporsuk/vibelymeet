
-- Reset both test users' queue states
UPDATE public.event_registrations
SET queue_status = 'idle', current_room_id = NULL, current_partner_id = NULL
WHERE profile_id IN ('2a0995e1-8ec8-4a11-bdfe-0877c3383f5c', '2cf4a5af-acc7-4450-899d-0c7dc85139e2');

-- Create a fresh live event for testing (starts now, lasts 120 minutes)
INSERT INTO public.events (
  title, description, cover_image, event_date, duration_minutes,
  max_attendees, max_male_attendees, max_female_attendees, current_attendees,
  status, is_free, tags, vibes, visibility
) VALUES (
  'Sunday Vibe Check ☀️',
  'A chill Sunday video speed dating event. Meet new people, make real connections!',
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&h=400&fit=crop',
  now(),
  120,
  50, 25, 25, 0,
  'live', true,
  ARRAY['Speed Dating', 'Video', 'Chill'],
  ARRAY['☀️ Sunday Vibes', '💬 Great Conversations'],
  'all'
);

-- Register both test users for the new event
INSERT INTO public.event_registrations (event_id, profile_id, queue_status)
SELECT e.id, '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c', 'idle'
FROM public.events e WHERE e.title = 'Sunday Vibe Check ☀️' AND e.event_date > now() - interval '5 minutes';

INSERT INTO public.event_registrations (event_id, profile_id, queue_status)
SELECT e.id, '2cf4a5af-acc7-4450-899d-0c7dc85139e2', 'idle'
FROM public.events e WHERE e.title = 'Sunday Vibe Check ☀️' AND e.event_date > now() - interval '5 minutes';
