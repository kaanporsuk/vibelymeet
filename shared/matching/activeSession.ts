/**
 * Shared active-session resolution for web + native (Stage 1 / Stream 1).
 * Lives under repo-root `shared/` (client-neutral), not Edge function bundles.
 * Registration queue_status is authoritative for routing; video_sessions confirms row is live.
 */

export type ActiveSessionKind = "video" | "ready_gate";

export type ActiveSessionBase = {
  kind: ActiveSessionKind;
  sessionId: string;
  eventId: string;
  partnerName?: string | null;
  queueStatus: "in_handshake" | "in_date" | "in_ready_gate";
};

/** Prefer in-date / handshake over ready gate when multiple rows exist (stale data guard). */
export function pickRegistrationForActiveSession<
  T extends { queue_status: string | null; current_room_id: string | null; event_id: string },
>(regs: T[]): T | null {
  const list = regs ?? [];
  const withRoom = list.filter((r) => r.current_room_id);
  const video =
    withRoom.find((r) => r.queue_status === "in_handshake" || r.queue_status === "in_date") ?? null;
  if (video) return video;
  return withRoom.find((r) => r.queue_status === "in_ready_gate") ?? null;
}
