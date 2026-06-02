-- Video Date privilege boundary hardening.
--
-- The live project drifted into explicit anon/authenticated EXECUTE grants on
-- worker-only SECURITY DEFINER functions because public-schema default
-- privileges grant broad access to new functions. Keep future objects closed by
-- default and reassert the narrow grants the Video Date flow actually needs.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping supabase_admin function default-privilege revoke; requires owner/superuser privileges.';
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping supabase_admin table default-privilege revoke; requires owner/superuser privileges.';
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping supabase_admin sequence default-privilege revoke; requires owner/superuser privileges.';
END
$$;

REVOKE ALL ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_post_date_pending_verdicts_stale(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_post_date_pending_verdicts_stale(interval, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_post_date_half_verdict_timeouts(interval, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_post_date_pending_verdict_reminder_result(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_date_pending_verdict_reminder_result(uuid, boolean, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_event_loop_observability(text, text, text, integer, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_loop_observability(text, text, text, integer, uuid, uuid, uuid, jsonb)
  TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO service_role;

DROP POLICY IF EXISTS "Admins can view pending post-date verdicts"
  ON public.post_date_pending_verdicts;
CREATE POLICY "Admins can view pending post-date verdicts"
  ON public.post_date_pending_verdicts
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all video_sessions"
  ON public.video_sessions;
CREATE POLICY "Admins can view all video_sessions"
  ON public.video_sessions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Participants can read sanitized video session events"
  ON public.video_session_events;
CREATE POLICY "Participants can read sanitized video session events"
  ON public.video_session_events
  FOR SELECT
  TO authenticated
  USING (
    visibility = 'participants'::text
    AND EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = video_session_events.session_id
        AND (
          vs.participant_1_id = auth.uid()
          OR vs.participant_2_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "Actors can read own actor-only video session events"
  ON public.video_session_events;
CREATE POLICY "Actors can read own actor-only video session events"
  ON public.video_session_events
  FOR SELECT
  TO authenticated
  USING (
    visibility = 'actor_only'::text
    AND actor = auth.uid()
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
