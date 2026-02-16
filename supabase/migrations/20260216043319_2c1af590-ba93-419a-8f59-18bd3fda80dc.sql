-- Drop the old constraint and recreate with all valid statuses
ALTER TABLE public.event_registrations DROP CONSTRAINT valid_queue_status;

ALTER TABLE public.event_registrations ADD CONSTRAINT valid_queue_status 
  CHECK (queue_status = ANY (ARRAY['idle'::text, 'browsing'::text, 'searching'::text, 'matched'::text, 'in_ready_gate'::text, 'in_date'::text, 'completed'::text]));