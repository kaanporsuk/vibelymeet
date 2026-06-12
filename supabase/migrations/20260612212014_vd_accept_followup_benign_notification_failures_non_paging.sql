-- VD acceptance-run follow-up (Issue 3): classify benign notification.send outbox failures as
-- non-paging in the single alert path.
--
-- Defect (live forensics 2026-06-12, acceptance tag vd-accept-20260612-297055): disposable or
-- push-unsubscribed users fail `notification.send` outbox rows with
-- last_error = 'notification_no_player_id' (preferences-row backfill is NOT sufficient — there is
-- no OneSignal player). Any failed_count > 0 classified as 'page' in
-- vw_video_date_recovery_alerts, and one page-severity dispatch fired during the acceptance run
-- (fingerprint provider_outbox:notification.send:failed, 2026-06-12 21:00:05Z). The runbook's
-- known-noise note already flagged 'notification_no_preferences' for the same treatment.
--
-- Fix (preserves the PR-9 "ONE alert path" posture; dispatcher continues to read only
-- vw_video_date_recovery_alerts and dispatches both 'page' and 'watch'):
--   * vw_video_date_lease_recovery_health gains a trailing benign_failed_count column:
--     failed notification.send rows whose last_error is one of the two known no-recipient
--     reasons ('notification_no_preferences', 'notification_no_player_id'). The deadlines lane
--     has no benign classification (always 0).
--   * vw_video_date_recovery_alerts pages only on non-benign failures
--     (failed_count - benign_failed_count > 0) or expired-lease pileups; benign-only failure
--     groups classify as 'watch' (still emitted, still dispatched, non-paging). Details payload
--     gains benignFailedCount.
--
-- Dependent scan (2026-06-12): no pg_depend view/function dependents; sole consumer is the
-- video-date-recovery-alert-dispatcher Edge Function (column-compatible — alerts view columns
-- unchanged); generated types refreshed in the same branch.

CREATE OR REPLACE VIEW public.vw_video_date_lease_recovery_health AS
WITH outbox AS (
  SELECT
    'provider_outbox'::text AS queue_name,
    o.kind,
    o.state,
    count(*) AS row_count,
    min(o.next_attempt_at) FILTER (WHERE o.state = ANY (ARRAY['pending'::text, 'claimed'::text])) AS oldest_due_at,
    count(*) FILTER (WHERE o.state = 'pending'::text AND o.next_attempt_at <= (now() - '00:02:00'::interval)) AS late_due_count,
    count(*) FILTER (WHERE o.state = 'claimed'::text AND o.claim_expires_at IS NOT NULL AND o.claim_expires_at <= now()) AS expired_lease_count,
    count(*) FILTER (WHERE o.attempts >= 5 AND o.state <> 'done'::text) AS high_attempt_count,
    count(*) FILTER (WHERE o.state = 'failed'::text) AS failed_count,
    max(o.attempts) AS max_attempts,
    count(*) FILTER (
      WHERE o.state = 'failed'::text
        AND o.kind = 'notification.send'::text
        AND o.last_error = ANY (ARRAY['notification_no_preferences'::text, 'notification_no_player_id'::text])
    ) AS benign_failed_count
  FROM public.video_date_provider_outbox o
  GROUP BY o.kind, o.state
), deadlines AS (
  SELECT
    'session_deadlines'::text AS queue_name,
    d.kind,
    d.state,
    count(*) AS row_count,
    min(d.due_at) FILTER (WHERE d.state = ANY (ARRAY['pending'::text, 'claimed'::text])) AS oldest_due_at,
    count(*) FILTER (WHERE d.state = 'pending'::text AND d.due_at <= (now() - '00:02:00'::interval)) AS late_due_count,
    count(*) FILTER (WHERE d.state = 'claimed'::text AND d.claim_expires_at IS NOT NULL AND d.claim_expires_at <= now()) AS expired_lease_count,
    count(*) FILTER (WHERE d.attempts >= 5 AND d.state <> 'done'::text) AS high_attempt_count,
    count(*) FILTER (WHERE d.state = 'failed'::text) AS failed_count,
    max(d.attempts) AS max_attempts,
    0::bigint AS benign_failed_count
  FROM public.video_session_deadlines d
  GROUP BY d.kind, d.state
)
SELECT
  queue_name,
  kind,
  state,
  row_count,
  oldest_due_at,
  CASE
    WHEN oldest_due_at IS NULL THEN NULL::integer
    ELSE (GREATEST((0)::numeric, EXTRACT(epoch FROM (now() - oldest_due_at))))::integer
  END AS oldest_due_age_seconds,
  late_due_count,
  expired_lease_count,
  high_attempt_count,
  failed_count,
  COALESCE(max_attempts, 0) AS max_attempts,
  benign_failed_count
FROM (
  SELECT
    outbox.queue_name, outbox.kind, outbox.state, outbox.row_count, outbox.oldest_due_at,
    outbox.late_due_count, outbox.expired_lease_count, outbox.high_attempt_count,
    outbox.failed_count, outbox.max_attempts, outbox.benign_failed_count
  FROM outbox
  UNION ALL
  SELECT
    deadlines.queue_name, deadlines.kind, deadlines.state, deadlines.row_count, deadlines.oldest_due_at,
    deadlines.late_due_count, deadlines.expired_lease_count, deadlines.high_attempt_count,
    deadlines.failed_count, deadlines.max_attempts, deadlines.benign_failed_count
  FROM deadlines
) health;

CREATE OR REPLACE VIEW public.vw_video_date_recovery_alerts AS
SELECT
  h.queue_name,
  h.kind,
  h.state,
  CASE
    WHEN ((h.failed_count - h.benign_failed_count) > 0 OR h.expired_lease_count > 5) THEN 'page'::text
    WHEN (h.failed_count > 0 OR h.late_due_count > 0 OR h.expired_lease_count > 0 OR h.high_attempt_count > 0) THEN 'watch'::text
    ELSE 'ok'::text
  END AS severity,
  jsonb_build_object(
    'rowCount', h.row_count,
    'oldestDueAt', h.oldest_due_at,
    'oldestDueAgeSeconds', h.oldest_due_age_seconds,
    'lateDueCount', h.late_due_count,
    'expiredLeaseCount', h.expired_lease_count,
    'highAttemptCount', h.high_attempt_count,
    'failedCount', h.failed_count,
    'benignFailedCount', h.benign_failed_count,
    'maxAttempts', h.max_attempts
  ) AS details,
  now() AS generated_at
FROM public.vw_video_date_lease_recovery_health h
WHERE (h.failed_count > 0 OR h.late_due_count > 0 OR h.expired_lease_count > 0 OR h.high_attempt_count > 0)
UNION ALL
SELECT
  'webhook_security'::text AS queue_name,
  'signature_rejected_stale'::text AS kind,
  'blocked'::text AS state,
  CASE
    WHEN (count(*) >= 10) THEN 'page'::text
    ELSE 'watch'::text
  END AS severity,
  jsonb_build_object(
    'rowCount', count(*),
    'oldestRejectedAt', min(e.created_at),
    'newestRejectedAt', max(e.created_at),
    'windowSeconds', 900,
    'maxTimestampSkewMs', max(((e.detail ->> 'max_timestamp_skew_ms'::text))::integer),
    'maxObservedSkewMs', max(((e.detail ->> 'skew_ms'::text))::integer)
  ) AS details,
  now() AS generated_at
FROM public.event_loop_observability_events e
WHERE e.operation = 'video_date_daily_webhook'::text
  AND e.reason_code = 'signature_rejected_stale'::text
  AND e.created_at >= (now() - '00:15:00'::interval)
HAVING count(*) > 0;

-- Preserve the service-role-only posture explicitly (CREATE OR REPLACE keeps grants; restated
-- for auditability).
REVOKE ALL ON public.vw_video_date_lease_recovery_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_lease_recovery_health TO service_role;
REVOKE ALL ON public.vw_video_date_recovery_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_recovery_alerts TO service_role;
