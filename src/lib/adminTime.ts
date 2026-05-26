const ADMIN_UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

const ADMIN_UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const ADMIN_UTC_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

function parseAdminDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAdminUtcDateTime(
  value: string | Date | null | undefined,
  fallback = "Never",
): string {
  if (!value) return fallback;
  const date = parseAdminDate(value);
  if (!date) return "Unavailable";
  return `${ADMIN_UTC_DATE_TIME_FORMATTER.format(date)} UTC`;
}

export function formatAdminUtcDate(
  value: string | Date | null | undefined,
  fallback = "Unavailable",
): string {
  const date = parseAdminDate(value);
  if (!date) return fallback;
  return `${ADMIN_UTC_DATE_FORMATTER.format(date)} UTC`;
}

export function formatAdminUtcTime(
  value: string | Date | null | undefined,
  fallback = "Unavailable",
): string {
  const date = parseAdminDate(value);
  if (!date) return fallback;
  return `${ADMIN_UTC_TIME_FORMATTER.format(date)} UTC`;
}

export function formatAdminUtcDateTimeForExport(value: string | Date | null | undefined): string {
  const date = parseAdminDate(value);
  if (!date) return "";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function adminUtcDayStartIso(value: string | Date | number = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Date.now()).toISOString().slice(0, 10) + "T00:00:00.000Z";
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export function formatAdminRelativeTime(value: string | Date | null | undefined, nowMs = Date.now()): string {
  const date = parseAdminDate(value);
  if (!date) return "Unavailable";
  const diffMs = nowMs - date.getTime();
  const future = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60_000);
  if (minutes < 1) return future ? "in <1m" : "just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  return formatAdminUtcDate(date);
}

export function formatAdminCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString();
}
