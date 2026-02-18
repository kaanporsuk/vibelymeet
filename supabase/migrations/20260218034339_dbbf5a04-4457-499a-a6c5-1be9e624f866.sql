
-- FIX 1: Recreate the admin view with explicit SECURITY INVOKER
-- The view already filters by has_role() and redacts tokens, but let's be explicit
DROP VIEW IF EXISTS public.push_notification_events_admin;

CREATE VIEW public.push_notification_events_admin
WITH (security_invoker = true)
AS
SELECT
  id,
  campaign_id,
  user_id,
  platform,
  status,
  queued_at,
  sent_at,
  delivered_at,
  opened_at,
  clicked_at,
  created_at,
  '[REDACTED]'::text AS fcm_message_id,
  '[REDACTED]'::text AS apns_message_id,
  '[REDACTED]'::text AS device_token,
  error_code,
  error_message
FROM push_notification_events
WHERE has_role(auth.uid(), 'admin'::app_role);

-- Ensure the view has no overly permissive policies
-- RLS on the underlying push_notification_events table already handles access control
