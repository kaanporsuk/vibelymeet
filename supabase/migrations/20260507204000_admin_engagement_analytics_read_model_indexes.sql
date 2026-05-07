-- Admin Engagement Analytics read-model support indexes.
--
-- The Engagement tab now reads aggregate telemetry through
-- admin_get_engagement_analytics. These indexes keep its UTC-windowed counts
-- backend-authoritative without turning the RPC into large sequential scans as
-- activity tables grow.

CREATE INDEX IF NOT EXISTS idx_admin_engagement_daily_drops_starts_at
  ON public.daily_drops (starts_at);

CREATE INDEX IF NOT EXISTS idx_admin_engagement_daily_drops_status_starts_at
  ON public.daily_drops (status, starts_at);

CREATE INDEX IF NOT EXISTS idx_admin_engagement_messages_created_at
  ON public.messages (created_at);

CREATE INDEX IF NOT EXISTS idx_admin_engagement_matches_matched_at
  ON public.matches (matched_at);

CREATE INDEX IF NOT EXISTS idx_admin_engagement_event_registrations_registered_at
  ON public.event_registrations (registered_at);

CREATE INDEX IF NOT EXISTS idx_admin_engagement_notification_log_created_category
  ON public.notification_log (created_at, category);

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507204000',
  'Admin Engagement Analytics read-model support indexes',
  'schema-only',
  'Adds non-destructive supporting indexes for the admin Engagement Analytics aggregate RPC over Daily Drop, message, match, event registration, and notification-log UTC windows. No user-facing data is mutated.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
