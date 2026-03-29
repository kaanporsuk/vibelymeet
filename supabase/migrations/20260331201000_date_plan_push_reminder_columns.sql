-- Idempotency for date-reminder-cron (minute scheduler): one push per window per plan

ALTER TABLE public.date_plans
ADD COLUMN IF NOT EXISTS reminder_push_30m_sent_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS reminder_push_5m_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.date_plans.reminder_push_30m_sent_at IS 'When the ~30min-before video date push was sent (prevents duplicate cron sends).';
COMMENT ON COLUMN public.date_plans.reminder_push_5m_sent_at IS 'When the ~5min-before video date push was sent (prevents duplicate cron sends).';
