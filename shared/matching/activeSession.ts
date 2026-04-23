/**
 * Shared active-session resolution for web + native (Stage 1 / Stream 1).
 * Lives under repo-root `shared/` (client-neutral), not Edge function bundles.
 * Registration `queue_status` drives routing; `video_sessions` confirms the row is live and can
 * override stale `in_ready_gate` when the session already entered handshake/date.
 *
 * Lobby hydration requires `current_room_id` — typical post-date `in_survey` clears that pointer on
 * the server, so survey is handled on `/date/:id`, not as an `ActiveSession` row. That is intentional.
 */

export type ActiveSessionKind = "video" | "ready_gate";

export type ActiveSessionBase = {
  kind: ActiveSessionKind;
  sessionId: string;
  eventId: string;
  partnerName?: string | null;
  queueStatus: "in_handshake" | "in_date" | "in_survey" | "in_ready_gate";
};

/** Prefer in-date / handshake / survey over ready gate when multiple rows exist (stale data guard). */
export function pickRegistrationForActiveSession<
  T extends { queue_status: string | null; current_room_id: string | null; event_id: string },
>(regs: T[]): T | null {
  const list = regs ?? [];
  const withRoom = list.filter((r) => r.current_room_id);
  const video =
    withRoom.find(
      (r) => r.queue_status === "in_handshake" || r.queue_status === "in_date" || r.queue_status === "in_survey"
    ) ?? null;
  if (video) return video;
  return withRoom.find((r) => r.queue_status === "in_ready_gate") ?? null;
}

/** True when `video_sessions` already reflects an in-call handshake or date (registration may lag `in_ready_gate`). */
export function videoSessionRowIndicatesHandshakeOrDate(
  row: {
    state?: string | null;
    phase?: string | null;
    handshake_started_at?: string | null;
    date_started_at?: string | null;
  } | null
): boolean {
  return Boolean(
    row &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.phase === "handshake" ||
        row.phase === "date" ||
        row.handshake_started_at ||
        row.date_started_at)
  );
}

/** Best-effort queue_status aligned with session row when registration still says `in_ready_gate`. */
export function inferVideoQueueStatusFromSessionTruth(
  row: {
    state?: string | null;
    phase?: string | null;
    date_started_at?: string | null;
  } | null
): "in_date" | "in_handshake" {
  if (!row) return "in_handshake";
  if (row.state === "date" || row.phase === "date" || row.date_started_at) return "in_date";
  return "in_handshake";
}
