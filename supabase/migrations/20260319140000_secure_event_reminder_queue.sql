-- Secure internal queue: RLS (no policies = no client access via PostgREST).
ALTER TABLE public.event_reminder_queue ENABLE ROW LEVEL SECURITY;

-- Restrict who can execute enqueue function (pg_cron / superuser / service_role contexts only).
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM authenticated;
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM anon;

-- Replace loop-based enqueue with set-based INSERT (ON CONFLICT replaces NOT EXISTS loops).
CREATE OR REPLACE FUNCTION public.send_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 30-minute reminders
  INSERT INTO event_reminder_queue (profile_id, event_id, event_title, reminder_type)
  SELECT er.profile_id, e.id, e.title, 'event_reminder_30m'
  FROM event_registrations er
  JOIN events e ON e.id = er.event_id
  WHERE e.event_date BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes'
    AND (e.status IS NULL OR e.status = 'published')
  ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;

  -- 5-minute reminders
  INSERT INTO event_reminder_queue (profile_id, event_id, event_title, reminder_type)
  SELECT er.profile_id, e.id, e.title, 'event_reminder_5m'
  FROM event_registrations er
  JOIN events e ON e.id = er.event_id
  WHERE e.event_date BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes'
    AND (e.status IS NULL OR e.status = 'published')
  ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;
END;
$$;

-- CREATE OR REPLACE resets default grants; lock down again.
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM authenticated;
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM anon;
