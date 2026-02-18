-- BUG 1 FIX: Add 'ended' to the events status CHECK constraint
ALTER TABLE public.events DROP CONSTRAINT events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check 
  CHECK (status = ANY (ARRAY['upcoming'::text, 'live'::text, 'completed'::text, 'cancelled'::text, 'ended'::text]));
