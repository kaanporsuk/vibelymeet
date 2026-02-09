
-- Clean up: end the test session and reset both users to idle
UPDATE video_sessions SET ended_at = now(), duration_seconds = 0 
WHERE id = '6e608a09-c028-41a2-93dc-8774e1ab3355';

UPDATE event_registrations 
SET queue_status = 'idle', current_room_id = NULL, current_partner_id = NULL
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33'
  AND profile_id IN ('2a0995e1-8ec8-4a11-bdfe-0877c3383f5c', '2cf4a5af-acc7-4450-899d-0c7dc85139e2');

-- Also extend the event duration so you have more time to test
UPDATE events SET duration_minutes = 120 WHERE id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33';
