-- Add per-channel dispatch claims so overlapping recovery alert runs cannot
-- duplicate Sentry or Slack side effects before sent timestamps are persisted.

ALTER TABLE public.video_date_recovery_alert_dispatches
  ADD COLUMN IF NOT EXISTS sentry_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS slack_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_video_date_recovery_alert_dispatches_sentry_claims
  ON public.video_date_recovery_alert_dispatches(sentry_claimed_at)
  WHERE sentry_sent_at IS NULL AND sentry_claimed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_date_recovery_alert_dispatches_slack_claims
  ON public.video_date_recovery_alert_dispatches(slack_claimed_at)
  WHERE slack_sent_at IS NULL AND slack_claimed_at IS NOT NULL;

COMMENT ON COLUMN public.video_date_recovery_alert_dispatches.sentry_claimed_at IS
  'Transient service-role claim used to avoid duplicate Sentry alert sends during overlapping dispatcher runs.';

COMMENT ON COLUMN public.video_date_recovery_alert_dispatches.slack_claimed_at IS
  'Transient service-role claim used to avoid duplicate Slack alert sends during overlapping dispatcher runs.';
