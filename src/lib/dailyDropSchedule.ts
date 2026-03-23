/**
 * Canonical Daily Drop timing (single source of truth for product copy + countdowns).
 *
 * Backend: pg_cron invokes `generate-daily-drops` at minute 0 of hour 18 UTC daily
 * (`supabase/migrations/20260322200100_daily_drop_cron.sql`). New rows use UTC `drop_date`
 * and `expires_at` at the next 18:00 UTC boundary from generation (`generate-daily-drops`).
 *
 * Clients must not assume “6 PM local”; use UTC batch semantics only.
 */

export const DAILY_DROP_BATCH_HOUR_UTC = 18;

/** Statuses that participate in opener / reply / pass (not terminal outcomes). */
export const DAILY_DROP_ACTIONABLE_STATUSES = [
  'active_unopened',
  'active_viewed',
  'active_opener_sent',
] as const;

/** In-window rows shown for matched / passed / invalidated UI (not “actionable” for pass/opener). */
export const DAILY_DROP_OUTCOME_STATUSES = ['matched', 'passed', 'invalidated'] as const;

export type DailyDropActionableStatus = (typeof DAILY_DROP_ACTIONABLE_STATUSES)[number];
export type DailyDropOutcomeStatus = (typeof DAILY_DROP_OUTCOME_STATUSES)[number];

/** Next scheduled batch start in UTC (18:00 UTC on the same UTC day if still before that instant, else next UTC day). */
export function getNextDailyDropBatchStartUtc(from: Date = new Date()): Date {
  const y = from.getUTCFullYear();
  const mo = from.getUTCMonth();
  const d = from.getUTCDate();
  const todayBatch = new Date(Date.UTC(y, mo, d, DAILY_DROP_BATCH_HOUR_UTC, 0, 0, 0));
  if (from.getTime() < todayBatch.getTime()) {
    return todayBatch;
  }
  return new Date(Date.UTC(y, mo, d + 1, DAILY_DROP_BATCH_HOUR_UTC, 0, 0, 0));
}

export function getMsUntilNextDailyDropBatchUtc(from: Date = new Date()): number {
  return Math.max(0, getNextDailyDropBatchStartUtc(from).getTime() - from.getTime());
}

/** Human-readable countdown until the next UTC batch (e.g. for “next drop” hints). */
export function formatCountdownToNextDailyDropBatchUtc(from: Date = new Date()): string {
  const totalSec = Math.floor(getMsUntilNextDailyDropBatchUtc(from) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}m`;
}

export const DAILY_DROP_REPLY_MAX_LENGTH = 500;
