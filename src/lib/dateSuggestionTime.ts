import { parseISO, setHours, setMinutes } from "date-fns";

const BLOCK_HOUR: Record<string, number> = {
  morning: 9,
  afternoon: 14,
  evening: 18,
  night: 21,
};

/** Combine Vibe Schedule slot date + block into a concrete instant (UTC ISO). */
export function slotDateBlockToStartsAt(slotDate: string, timeBlock: string): string {
  const base = parseISO(`${slotDate}T12:00:00`);
  const h = BLOCK_HOUR[timeBlock] ?? 12;
  return setMinutes(setHours(base, h), 0).toISOString();
}
