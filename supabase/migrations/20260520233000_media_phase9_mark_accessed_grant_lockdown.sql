-- Phase 9 grant lockdown: access tracking must remain service-role only.
--
-- The signed/proxied media resolver updates media_assets.last_accessed_at
-- through a service-role Edge Function. Direct client execution would let any
-- authenticated caller refresh cold-tier access timestamps for arbitrary asset
-- ids, so revoke explicit anon/authenticated grants and leave only service_role.

REVOKE ALL ON FUNCTION public.mark_media_asset_accessed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_media_asset_accessed(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mark_media_asset_accessed(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_media_asset_accessed(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_media_asset_accessed(uuid) IS
  'Service-role-only media access tracker used by signed/proxied URL issuance for Phase 9 cold-tiering.';

NOTIFY pgrst, 'reload schema';
