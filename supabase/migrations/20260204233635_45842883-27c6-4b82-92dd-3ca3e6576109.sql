-- Create a secure view for push notification events that masks sensitive device tokens
-- Admins can view delivery stats without seeing raw tokens

-- First, drop the existing admin policy that exposes device tokens
DROP POLICY IF EXISTS "Admins can view all notification events" ON public.push_notification_events;

-- Create a secure view that excludes sensitive token data but keeps analytics useful
CREATE OR REPLACE VIEW public.push_notification_events_admin
WITH (security_invoker = on) AS
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
  -- Mask the actual tokens - only show if they exist (for debugging) but not the values
  CASE WHEN fcm_message_id IS NOT NULL THEN '[REDACTED]' ELSE NULL END as fcm_message_id,
  CASE WHEN apns_message_id IS NOT NULL THEN '[REDACTED]' ELSE NULL END as apns_message_id,
  CASE WHEN device_token IS NOT NULL THEN '[REDACTED]' ELSE NULL END as device_token,
  -- Keep error info for debugging
  error_code,
  error_message
FROM public.push_notification_events;

-- Grant SELECT on the view to authenticated users (RLS will handle access)
GRANT SELECT ON public.push_notification_events_admin TO authenticated;

-- Create a new policy that only allows admin SELECT through the view
-- The base table now has NO direct admin SELECT access
CREATE POLICY "Admins can view notification events via view only"
  ON public.push_notification_events
  FOR SELECT
  TO authenticated
  USING (
    -- Only service_role or the user viewing their own events
    auth.role() = 'service_role' OR auth.uid() = user_id
  );