-- Restrict OneSignal push subscription ownership RPCs to authenticated callers.
--
-- The RPC bodies also require auth.uid(), but Supabase function defaults can
-- leave explicit anon EXECUTE grants behind. Keep the exposed surface
-- least-privilege while preserving service-role automation.

REVOKE EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
