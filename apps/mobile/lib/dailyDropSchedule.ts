/**
 * Canonical Daily Drop timing — keep in sync with `src/lib/dailyDropSchedule.ts`.
 *
 * Backend batch: 18:00 UTC daily (`generate-daily-drops`). No per-user local scheduling.
 */

export const DAILY_DROP_BATCH_HOUR_UTC = 18;

export const DAILY_DROP_ACTIONABLE_STATUSES = [
  'active_unopened',
  'active_viewed',
  'active_opener_sent',
] as const;

export const DAILY_DROP_OUTCOME_STATUSES = ['matched', 'passed', 'invalidated'] as const;

export type DailyDropActionableStatus = (typeof DAILY_DROP_ACTIONABLE_STATUSES)[number];
export type DailyDropOutcomeStatus = (typeof DAILY_DROP_OUTCOME_STATUSES)[number];

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

export function formatCountdownToNextDailyDropBatchUtc(from: Date = new Date()): string {
  const totalSec = Math.floor(getMsUntilNextDailyDropBatchUtc(from) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}m`;
}

export const DAILY_DROP_REPLY_MAX_LENGTH = 500;
