
-- Fix function search path
ALTER FUNCTION public.create_notification_preferences() SET search_path = 'public';

-- Fix overly permissive INSERT policy on notification_log
DROP POLICY IF EXISTS "Service role can insert notification logs" ON public.notification_log;
