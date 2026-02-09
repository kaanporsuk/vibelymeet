
-- Simulate Kaan joining the queue
UPDATE public.event_registrations
SET queue_status = 'searching', joined_queue_at = now()
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
  AND profile_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2';

-- Create video session (what find_video_date_match would do)
INSERT INTO public.video_sessions (event_id, participant_1_id, participant_2_id)
VALUES (
  '4e3b1ab7-b97e-4951-bc8c-2c059f700f33',
  '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c',
  '2cf4a5af-acc7-4450-899d-0c7dc85139e2'
);

-- Update both to matched status with the new session ID
UPDATE public.event_registrations
SET queue_status = 'matched',
    current_room_id = (
      SELECT id FROM public.video_sessions 
      WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
        AND participant_1_id = '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c'
        AND participant_2_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2'
        AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    ),
    current_partner_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2',
    last_matched_at = now()
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
  AND profile_id = '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c';

UPDATE public.event_registrations
SET queue_status = 'matched',
    current_room_id = (
      SELECT id FROM public.video_sessions 
      WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
        AND participant_1_id = '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c'
        AND participant_2_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2'
        AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    ),
    current_partner_id = '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c',
    last_matched_at = now()
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
  AND profile_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2';
