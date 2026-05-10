/**
 * Pure helpers for the chat schedule-share flow. Used on the web client
 * (ExactTimePinSheet, ScheduleSharePicker, DateSuggestionCard) and mirror the
 * SQL definitions in `_block_hour_range` and `_apply_date_plan_event_lock`.
 *
 * Keeping these pure (no React, no Supabase) so they're testable with
 * node:test + assert/strict (matches the rest of shared/).
 */

export type TimeBlock = "morning" | "afternoon" | "evening" | "night";

export const TIME_BLOCKS: readonly TimeBlock[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const;

/** Mirror of SQL `_block_hour_range`. End is exclusive (e.g. evening = [17, 21)). */
export const BLOCK_HOUR_RANGES: Record<TimeBlock, { startHour: number; endHour: number }> = {
  morning: { startHour: 8, endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening: { startHour: 17, endHour: 21 },
  night: { startHour: 21, endHour: 24 },
};

/** Format used by `useSchedule.generateSlotKey` and `user_schedules.slot_key`. */
export function formatSlotKey(slotDate: string, block: TimeBlock): string {
  return `${slotDate}_${block}`;
}

export type ParsedSlotKey = { slotDate: string; timeBlock: TimeBlock };

/** Parse a slot_key in `YYYY-MM-DD_<block>` format. Returns null on malformed input. */
export function parseSlotKey(slotKey: string | null | undefined): ParsedSlotKey | null {
  if (!slotKey || typeof slotKey !== "string") return null;
  if (slotKey.length < 12) return null;
  if (slotKey[10] !== "_") return null;
  const slotDate = slotKey.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return null;
  const block = slotKey.slice(11);
  if (!TIME_BLOCKS.includes(block as TimeBlock)) return null;
  return { slotDate, timeBlock: block as TimeBlock };
}

/** True when an hour-of-day falls inside the block's range. End-exclusive. */
export function hourInBlock(hour: number, block: TimeBlock): boolean {
  const { startHour, endHour } = BLOCK_HOUR_RANGES[block];
  return hour >= startHour && hour < endHour;
}

/**
 * Compute mutual overlap between two sets of slot keys.
 * Used by DateSuggestionCard to mark "Both open" chips.
 */
export function intersectSlotKeys(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b);
  return a.filter((k) => set.has(k));
}
