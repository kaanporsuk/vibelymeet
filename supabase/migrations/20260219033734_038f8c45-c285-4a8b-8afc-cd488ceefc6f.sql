
-- FIX 1: Drop stale queue_status CHECK constraint and add updated one
ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS valid_queue_status;
ALTER TABLE public.event_registrations 
ADD CONSTRAINT valid_queue_status 
CHECK (queue_status IN (
  'idle', 'searching', 'matched', 'in_date', 'completed',
  'browsing', 'in_ready_gate', 'in_handshake', 'in_survey', 'offline'
));

-- FIX 2: Re-add foreign keys with ON DELETE CASCADE
ALTER TABLE public.event_registrations 
  DROP CONSTRAINT IF EXISTS event_registrations_event_id_fkey;
ALTER TABLE public.event_registrations 
  ADD CONSTRAINT event_registrations_event_id_fkey 
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.event_swipes 
  DROP CONSTRAINT IF EXISTS event_swipes_event_id_fkey;
ALTER TABLE public.event_swipes 
  ADD CONSTRAINT event_swipes_event_id_fkey 
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.video_sessions 
  DROP CONSTRAINT IF EXISTS video_sessions_event_id_fkey;
ALTER TABLE public.video_sessions 
  ADD CONSTRAINT video_sessions_event_id_fkey 
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.date_feedback 
  DROP CONSTRAINT IF EXISTS date_feedback_session_id_fkey;
ALTER TABLE public.date_feedback 
  ADD CONSTRAINT date_feedback_session_id_fkey 
  FOREIGN KEY (session_id) REFERENCES public.video_sessions(id) ON DELETE CASCADE;

-- FIX 3: Admin RLS for deleting event registrations
CREATE POLICY "Admins can delete event registrations"
ON public.event_registrations
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::app_role));
