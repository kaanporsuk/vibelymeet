/**
 * Open/active statuses for a date suggestion in a match. A status can be
 * "open" without still blocking a new proposal: exact/vague proposals age out
 * by their proposed window, while drafts and schedule-share negotiations keep
 * their existing one-open-per-match semantics.
 */
export const DATE_SUGGESTION_OPEN_STATUSES: readonly string[] = [
  'draft',
  'proposed',
  'viewed',
  'countered',
];

export type DateSuggestionBlockingRevision = {
  id?: string | null;
  time_choice_key?: string | null;
  schedule_share_enabled?: boolean | null;
  starts_at?: string | null;
  created_at?: string | null;
  local_timezone?: string | null;
};

export type DateSuggestionBlockingRecord = {
  status: string;
  current_revision_id?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  schedule_share_expires_at?: string | null;
  revisions?: readonly DateSuggestionBlockingRevision[] | null;
};

const VAGUE_TIME_CHOICE_KEYS = new Set(['tonight', 'tomorrow', 'this_weekend', 'next_week']);

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function currentRevision(record: DateSuggestionBlockingRecord): DateSuggestionBlockingRevision | null {
  const revisions = record.revisions ?? [];
  if (revisions.length === 0) return null;
  if (record.current_revision_id) {
    return revisions.find((revision) => revision.id === record.current_revision_id) ?? revisions[revisions.length - 1] ?? null;
  }
  return revisions[revisions.length - 1] ?? null;
}

function timezoneDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; isoDay: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error('invalid_timezone_parts');
  }
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, isoDay: utcDay === 0 ? 7 : utcDay };
}

function timezoneDateTimeParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');
  const second = pick('second');
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    throw new Error('invalid_timezone_datetime_parts');
  }
  return { year, month, day, hour, minute, second };
}

function addCalendarDays(
  parts: Pick<ReturnType<typeof timezoneDateParts>, 'year' | 'month' | 'day'>,
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localMidnightInTimezoneMs(
  parts: Pick<ReturnType<typeof timezoneDateParts>, 'year' | 'month' | 'day'>,
  timeZone: string,
): number {
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  let guess = targetAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const local = timezoneDateTimeParts(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      0,
    );
    const delta = targetAsUtc - localAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

export function dateSuggestionWindowEndMs(params: {
  timeChoiceKey: string | null | undefined;
  startsAt?: string | null;
  anchorCreatedAt?: string | null;
  expiresAt?: string | null;
  scheduleShareExpiresAt?: string | null;
  scheduleShareEnabled?: boolean | null;
  localTimezone?: string | null;
  nowMs?: number;
}): number | null {
  const exactStartMs = parseMs(params.startsAt);
  if (exactStartMs != null) return exactStartMs;

  const timeChoiceKey = params.timeChoiceKey ?? '';
  if (timeChoiceKey === 'share_schedule' || params.scheduleShareEnabled === true) {
    return parseMs(params.scheduleShareExpiresAt) ?? parseMs(params.expiresAt);
  }

  if (!VAGUE_TIME_CHOICE_KEYS.has(timeChoiceKey)) {
    return parseMs(params.expiresAt);
  }

  const anchorMs = parseMs(params.anchorCreatedAt) ?? params.nowMs ?? Date.now();
  const timeZone = params.localTimezone?.trim() || 'UTC';
  try {
    const anchorParts = timezoneDateParts(new Date(anchorMs), timeZone);
    let daysToEnd: number;
    if (timeChoiceKey === 'tonight') {
      daysToEnd = 1;
    } else if (timeChoiceKey === 'tomorrow') {
      daysToEnd = 2;
    } else if (timeChoiceKey === 'this_weekend') {
      daysToEnd = 8 - anchorParts.isoDay;
    } else {
      daysToEnd = 15 - anchorParts.isoDay;
    }
    return localMidnightInTimezoneMs(addCalendarDays(anchorParts, daysToEnd), timeZone);
  } catch {
    return null;
  }
}

export function dateSuggestionBlocksNewProposal(
  suggestion: DateSuggestionBlockingRecord,
  nowMs = Date.now(),
): boolean {
  if (!DATE_SUGGESTION_OPEN_STATUSES.includes(suggestion.status)) return false;
  if (suggestion.status === 'draft') return true;

  const revision = currentRevision(suggestion);
  if (!revision) {
    const expiresAtMs = parseMs(suggestion.expires_at);
    return expiresAtMs == null ? true : expiresAtMs > nowMs;
  }

  const windowEndMs = dateSuggestionWindowEndMs({
    timeChoiceKey: revision.time_choice_key,
    startsAt: revision.starts_at,
    anchorCreatedAt: revision.created_at ?? suggestion.created_at,
    expiresAt: suggestion.expires_at,
    scheduleShareExpiresAt: suggestion.schedule_share_expires_at,
    scheduleShareEnabled: revision.schedule_share_enabled,
    localTimezone: revision.local_timezone ?? 'UTC',
    nowMs,
  });
  return windowEndMs == null ? true : windowEndMs > nowMs;
}

export function findBlockingDateSuggestion<T extends DateSuggestionBlockingRecord>(
  suggestions: ReadonlyArray<T> | null | undefined,
  nowMs = Date.now(),
): T | null {
  if (!suggestions?.length) return null;
  return suggestions.find((suggestion) => dateSuggestionBlocksNewProposal(suggestion, nowMs)) ?? null;
}

export function matchHasOpenDateSuggestion(
  suggestions: ReadonlyArray<{ status: string }> | null | undefined,
): boolean {
  if (!suggestions?.length) return false;
  return suggestions.some((suggestion) => DATE_SUGGESTION_OPEN_STATUSES.includes(suggestion.status));
}
