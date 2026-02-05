-- Drop the existing view
DROP VIEW IF EXISTS public.push_notification_events_admin;

-- Recreate the view with security_barrier to prevent information leakage
-- The view masks sensitive fields and relies on has_role check
CREATE VIEW public.push_notification_events_admin 
WITH (security_barrier = true)
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
FROM public.push_notification_events
WHERE public.has_role(auth.uid(), 'admin'::app_role);

-- Grant select to authenticated users (the view's WHERE clause handles authorization)
GRANT SELECT ON public.push_notification_events_admin TO authenticated;