
-- Reset both users back to idle for fresh manual testing
UPDATE public.event_registrations
SET queue_status = 'idle', current_room_id = NULL, current_partner_id = NULL
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33';

-- End the test session we created
UPDATE public.video_sessions
SET ended_at = now(), duration_seconds = 0
WHERE event_id = '4e3b1ab7-b97e-4951-bc8c-2c059f700f33' AND ended_at IS NULL;
