-- Recreate admin push telemetry with null-preserving redaction.
-- Non-null sensitive identifiers are redacted; missing identifiers remain null.

DROP VIEW IF EXISTS public.push_notification_events_admin;

-- This stays owner-executed with an explicit admin predicate. The base table RLS
-- intentionally does not grant admins all-row SELECT, so security_invoker would
-- collapse this redacted admin read model to the caller's base-table visibility.
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
  CASE WHEN fcm_message_id IS NULL THEN NULL ELSE '[REDACTED]'::text END AS fcm_message_id,
  CASE WHEN apns_message_id IS NULL THEN NULL ELSE '[REDACTED]'::text END AS apns_message_id,
  CASE WHEN device_token IS NULL THEN NULL ELSE '[REDACTED]'::text END AS device_token,
  error_code,
  error_message
FROM public.push_notification_events
WHERE public.has_role(auth.uid(), 'admin'::public.app_role);

REVOKE ALL ON public.push_notification_events_admin FROM PUBLIC;
GRANT SELECT ON public.push_notification_events_admin TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507154000',
  'Push telemetry admin null-preserving redaction',
  'schema-only',
  'Recreates the admin push telemetry view so null sensitive identifiers remain null while non-null identifiers are redacted. No push delivery or user-facing behavior is added.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON VIEW public.push_notification_events_admin IS
  'Admin-only security-barrier push telemetry view that preserves nullness while redacting provider identifiers and device tokens.';
