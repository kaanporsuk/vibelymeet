-- Event reminders (30min + 5min before): queue table + cron to enqueue.
-- Requires pg_cron (Supabase Cloud). If pg_cron is not available, use the event-reminders
-- Edge Function on a schedule (external cron or Supabase scheduled invocations) to both
-- enqueue and process reminders.

-- Queue: one row per (profile, event, reminder_type). Processor sets sent_at when sent.
CREATE TABLE IF NOT EXISTS public.event_reminder_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_title text NOT NULL,
  reminder_type text NOT NULL CHECK (reminder_type IN ('event_reminder_30m', 'event_reminder_5m')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (profile_id, event_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_event_reminder_queue_pending
  ON public.event_reminder_queue (created_at)
  WHERE sent_at IS NULL;

COMMENT ON TABLE public.event_reminder_queue IS 'Event reminder push notifications; cron enqueues, Edge Function processes.';

-- Function: find events starting in 30min or 5min and enqueue one row per registration.
CREATE OR REPLACE FUNCTION public.send_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reg RECORD;
BEGIN
  -- 30-minute reminders
  FOR reg IN
    SELECT er.profile_id, e.id AS event_id, e.title AS event_title
    FROM event_registrations er
    JOIN events e ON e.id = er.event_id
    WHERE e.event_date BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes'
      AND (e.status IS NULL OR e.status = 'published')
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_queue q
        WHERE q.profile_id = er.profile_id
          AND q.event_id = e.id
          AND q.reminder_type = 'event_reminder_30m'
      )
  LOOP
    INSERT INTO event_reminder_queue (profile_id, event_id, event_title, reminder_type)
    VALUES (reg.profile_id, reg.event_id, reg.event_title, 'event_reminder_30m')
    ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;
  END LOOP;

  -- 5-minute reminders
  FOR reg IN
    SELECT er.profile_id, e.id AS event_id, e.title AS event_title
    FROM event_registrations er
    JOIN events e ON e.id = er.event_id
    WHERE e.event_date BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes'
      AND (e.status IS NULL OR e.status = 'published')
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_queue q
        WHERE q.profile_id = er.profile_id
          AND q.event_id = e.id
          AND q.reminder_type = 'event_reminder_5m'
      )
  LOOP
    INSERT INTO event_reminder_queue (profile_id, event_id, event_title, reminder_type)
    VALUES (reg.profile_id, reg.event_id, reg.event_title, 'event_reminder_5m')
    ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;
  END LOOP;
END;
$$;

-- Schedule to run every minute (requires pg_cron extension; skip if not available).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'event-reminders-enqueue',
      '* * * * *',
      'SELECT public.send_event_reminders()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available: %. Use event-reminders Edge Function on a 1-minute schedule instead.', SQLERRM;
END;
$$;
