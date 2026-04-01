/**
 * Calendar-date helpers for onboarding DOB (YYYY-MM-DD).
 * Avoids Date#toISOString and UTC parsing of date-only strings, which break
 * web selects and age checks across timezones.
 */

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseDateParts(value: string): DateParts | null {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [year, month, day] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function calculateAgeFromDateParts(parts: DateParts): number {
  const { year, month, day } = parts;
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDelta = today.getMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) age -= 1;
  return age;
}

export function calculateAgeFromIsoDate(value: string): number | null {
  const parts = parseDateParts(value);
  if (!parts) return null;
  return calculateAgeFromDateParts(parts);
}

export function formatIsoDate(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
