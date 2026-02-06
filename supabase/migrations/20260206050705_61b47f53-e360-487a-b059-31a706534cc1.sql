-- Set User 2 (Kaan) to searching status to simulate them joining
UPDATE public.event_registrations
SET queue_status = 'searching',
    joined_queue_at = now()
WHERE event_id = 'eaef553c-fbc0-4875-86b7-cb8739931c05'
  AND profile_id = '2cf4a5af-acc7-4450-899d-0c7dc85139e2';