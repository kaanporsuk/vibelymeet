/**
 * Single-line label for a concrete proposal datetime (user-local timezone).
 * Example (en-US): "Thu, Mar 6 · 7:30 PM"
 */
export function formatProposedDateTimeSummary(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dateStr = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${dateStr} · ${timeStr}`;
}

/** Merge a calendar day (local) with clock fields from a time-only Date (local). */
export function mergeLocalDateAndTime(dateDay: Date, timeSource: Date): Date {
  const out = new Date(dateDay);
  out.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);
  return out;
}
