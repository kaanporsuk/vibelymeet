-- Tighten Activity Status RPC execute grants after cloud verification.
-- Supabase function defaults had explicit anon/authenticated EXECUTE grants;
-- user-facing RPCs should be authenticated-only, and the internal helper should
-- remain service-role-only.

REVOKE ALL ON FUNCTION public.get_my_privacy_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_privacy_settings(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_my_activity_seen() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_view_profile_presence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_profile_presence_for_viewer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_chat_partner_presence(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_privacy_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_privacy_settings(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_my_activity_seen() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_profile_presence(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_presence_for_viewer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_partner_presence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) TO authenticated, service_role;
