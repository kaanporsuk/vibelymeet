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

export type VideoSessionTruthRouteDecision = "navigate_date" | "navigate_ready" | "stay_lobby" | "ended";

type VideoSessionDailyRoomTruth = {
  ended_at?: string | null;
  handshake_started_at?: string | null;
  ready_gate_expires_at?: string | number | null;
  ready_gate_status?: string | null;
  state?: string | null;
};

function readyGateExpiryMs(
  rawExpiry: string | number | null | undefined,
): number | null {
  if (rawExpiry == null) return null;
  const expiresMs =
    typeof rawExpiry === "number"
      ? rawExpiry
      : Date.parse(String(rawExpiry));
  return Number.isFinite(expiresMs) ? expiresMs : null;
}

/**
 * Canonical client mirror of the Daily room server gate.
 * Legacy `phase` is intentionally ignored: mixed rows can still carry
 * `phase = "handshake"` while the canonical state remains `ready_gate`.
 */
export function canAttemptDailyRoomFromVideoSessionTruth(
  row: VideoSessionDailyRoomTruth | null,
  nowMs: number = Date.now(),
): boolean {
  if (!row || row.ended_at) return false;
  if (
    row.state === "handshake" ||
    row.state === "date" ||
    row.handshake_started_at
  ) {
    return true;
  }
  if (row.ready_gate_status !== "both_ready") return false;
  const expiresMs = readyGateExpiryMs(row.ready_gate_expires_at);
  return expiresMs != null && expiresMs > nowMs;
}

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

/**
 * True when `video_sessions` already reflects an authoritative handshake/date transition.
 * Do not trust legacy `phase` alone here.
 */
export function videoSessionRowIndicatesHandshakeOrDate(
  row: {
    state?: string | null;
    handshake_started_at?: string | null;
  } | null
): boolean {
  return Boolean(
    row &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.handshake_started_at)
  );
}

export function videoSessionRowIsEnded(
  row: {
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null
): boolean {
  return Boolean(row && (row.ended_at || row.state === "ended" || row.phase === "ended"));
}

export function videoSessionRowReadyGateEligible(
  row: {
    ready_gate_status?: string | null;
    ready_gate_expires_at?: string | number | null;
  } | null,
  nowMs: number = Date.now()
): boolean {
  if (!row) return false;
  const status = row.ready_gate_status ?? null;
  if (status === "ready" || status === "ready_a" || status === "ready_b" || status === "snoozed") {
    return true;
  }
  if (status !== "both_ready") return false;
  const expiresMs = readyGateExpiryMs(row.ready_gate_expires_at);
  return expiresMs != null && expiresMs > nowMs;
}

export function decideVideoSessionRouteFromTruth(
  row: {
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
    handshake_started_at?: string | null;
    date_started_at?: string | null;
    ready_gate_status?: string | null;
    ready_gate_expires_at?: string | number | null;
  } | null,
  nowMs: number = Date.now()
): VideoSessionTruthRouteDecision {
  if (!row) return "stay_lobby";
  if (videoSessionRowIsEnded(row)) return "ended";
  if (videoSessionRowIndicatesHandshakeOrDate(row)) return "navigate_date";
  if (videoSessionRowReadyGateEligible(row, nowMs)) return "navigate_ready";
  return "stay_lobby";
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
