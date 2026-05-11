-- Add the remaining date/schedule planning tables to Supabase Realtime.
-- Realtime payloads are used only as cache invalidation signals; authorized
-- SELECT/RPC paths remain the display source of truth.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule_share_grants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_share_grants;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_schedules'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_schedules;
  END IF;
END $$;
