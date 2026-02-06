-- Create a live test event for video call testing
INSERT INTO public.events (
  title,
  description,
  event_date,
  duration_minutes,
  max_attendees,
  current_attendees,
  cover_image,
  status,
  is_free,
  visibility
) VALUES (
  'Video Call Test Event',
  'Test event for video call functionality',
  NOW(),
  60,
  100,
  2,
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
  'live',
  true,
  'all'
);

-- Get the event id and register both test users
DO $$
DECLARE
  new_event_id uuid;
BEGIN
  SELECT id INTO new_event_id FROM public.events WHERE title = 'Video Call Test Event' ORDER BY created_at DESC LIMIT 1;
  
  -- Register first user (direklocal@gmail.com)
  INSERT INTO public.event_registrations (event_id, profile_id, queue_status)
  VALUES (new_event_id, '2cf4a5af-acc7-4450-899d-0c7dc85139e2', 'idle')
  ON CONFLICT DO NOTHING;
  
  -- Register second user (kaanporsuk@gmail.com)
  INSERT INTO public.event_registrations (event_id, profile_id, queue_status)
  VALUES (new_event_id, '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c', 'idle')
  ON CONFLICT DO NOTHING;
END $$;