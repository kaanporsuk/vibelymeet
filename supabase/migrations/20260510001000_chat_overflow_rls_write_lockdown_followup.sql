-- Follow-up for already-applied chat overflow actions migration.
-- Keep match archive and mute writes server-owned through RPCs only.

ALTER TABLE public.match_archives ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.match_archives TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_archives FROM authenticated;

DROP POLICY IF EXISTS "Users can create own match archives" ON public.match_archives;
DROP POLICY IF EXISTS "Users can update own match archives" ON public.match_archives;
DROP POLICY IF EXISTS "Users can delete own match archives" ON public.match_archives;

ALTER TABLE public.match_notification_mutes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.match_notification_mutes TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_notification_mutes FROM authenticated;

DROP POLICY IF EXISTS "Users can create own match notification mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can update own match notification mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can delete own match notification mutes" ON public.match_notification_mutes;

REVOKE ALL ON FUNCTION public.set_match_archive_state(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_match_notification_mute(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_match_notification_mute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_match_archive_state(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_match_notification_mute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_match_notification_mute(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmatch_match(uuid) TO authenticated;
