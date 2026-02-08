-- Reset both test users' event registrations to idle so they can test fresh
UPDATE public.event_registrations
SET queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    joined_queue_at = NULL,
    last_matched_at = NULL
WHERE profile_id IN ('2cf4a5af-acc7-4450-899d-0c7dc85139e2', '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c');

-- End any active video sessions for these users
UPDATE public.video_sessions
SET ended_at = now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::integer
WHERE ended_at IS NULL
AND (participant_1_id IN ('2cf4a5af-acc7-4450-899d-0c7dc85139e2', '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c')
  OR participant_2_id IN ('2cf4a5af-acc7-4450-899d-0c7dc85139e2', '2a0995e1-8ec8-4a11-bdfe-0877c3383f5c'));