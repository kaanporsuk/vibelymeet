-- Trigger-only permission helpers must not be exposed as callable RPCs.

BEGIN;

REVOKE ALL ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  TO service_role;

REVOKE ALL ON FUNCTION public.prevent_direct_onesignal_legacy_mirror_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_direct_onesignal_legacy_mirror_write()
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
