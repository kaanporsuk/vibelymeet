ALTER TABLE public.event_registrations DROP CONSTRAINT valid_queue_status;

ALTER TABLE public.event_registrations ADD CONSTRAINT valid_queue_status 
  CHECK (queue_status IN ('idle', 'browsing', 'searching', 'matched', 'in_ready_gate', 'in_handshake', 'in_date', 'in_survey', 'completed', 'offline'));