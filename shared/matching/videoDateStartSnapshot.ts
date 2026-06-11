export const VIDEO_DATE_START_SNAPSHOT_RPC_NAME = "get_video_date_start_snapshot_v1";

export type VideoDateStartSnapshotRecord = Record<string, unknown>;

export type VideoDateStartSnapshot = {
  ok: boolean;
  error: string | null;
  retryable: boolean | null;
  terminal: boolean | null;
  sessionId: string | null;
  eventId: string | null;
  partnerId: string | null;
  readyGateStatus: string | null;
  canMarkReady: boolean | null;
  canEnterDate: boolean | null;
  raw: VideoDateStartSnapshotRecord;
};

export function normalizeVideoDateStartSnapshot(payload: unknown): VideoDateStartSnapshot {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as VideoDateStartSnapshotRecord)
    : {};

  return {
    ok: raw.ok === true || raw.success === true,
    error: nullableString(raw.error) ?? nullableString(raw.reason),
    retryable: nullableBoolean(raw.retryable),
    terminal: nullableBoolean(raw.terminal),
    sessionId: nullableString(raw.session_id) ?? nullableString(raw.sessionId),
    eventId: nullableString(raw.event_id) ?? nullableString(raw.eventId),
    partnerId: nullableString(raw.partner_id) ?? nullableString(raw.partnerId),
    readyGateStatus:
      nullableString(raw.ready_gate_status) ??
      nullableString(raw.status) ??
      nullableString(raw.result_ready_gate_status) ??
      nullableString(raw.result_status),
    canMarkReady: nullableBoolean(raw.can_mark_ready) ?? nullableBoolean(raw.canMarkReady),
    canEnterDate: nullableBoolean(raw.can_enter_date) ?? nullableBoolean(raw.canEnterDate),
    raw,
  };
}

export function videoDateStartSnapshotToDateEntryTruth(
  snapshot: VideoDateStartSnapshot,
): VideoDateStartSnapshotRecord | null {
  if (!snapshot.ok) return null;
  const raw = snapshot.raw;
  return {
    id: snapshot.sessionId,
    participant_1_id: nullableString(raw.participant_1_id),
    participant_2_id: nullableString(raw.participant_2_id),
    ended_at: nullableString(raw.ended_at),
    ended_reason: nullableString(raw.ended_reason) ?? nullableString(raw.endedReason),
    event_id: snapshot.eventId,
    daily_room_name: nullableString(raw.daily_room_name),
    daily_room_url: nullableString(raw.daily_room_url),
    entry_started_at: nullableString(raw.entry_started_at),
    date_started_at: nullableString(raw.date_started_at),
    state: nullableString(raw.state),
    phase: nullableString(raw.normalized_phase) ?? nullableString(raw.phase),
    ready_gate_status: snapshot.readyGateStatus,
    ready_gate_expires_at: nullableString(raw.ready_gate_expires_at) ?? nullableNumber(raw.phaseDeadlineAt),
    participant_1_joined_at: nullableString(raw.participant_1_joined_at),
    participant_2_joined_at: nullableString(raw.participant_2_joined_at),
    participant_1_remote_seen_at: nullableString(raw.participant_1_remote_seen_at),
    participant_2_remote_seen_at: nullableString(raw.participant_2_remote_seen_at),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
