export type VideoDateSnapshotPhase =
  | "queued"
  | "ready_gate"
  | "handshake"
  | "date"
  | "verdict"
  | "ended"
  | string;

export type VideoDateSnapshotParticipant = {
  id: string | null;
  isSelf: boolean;
  isPartner: boolean;
  mediaJoinedAt: number | null;
  awayAt: number | null;
};

export type VideoDateSnapshotRoom = {
  name: string | null;
  url: string | null;
  tokenRequired: boolean;
  token?: string | null;
  tokenExpiresAt?: number | null;
};

export type VideoDateSnapshotOk = {
  ok: true;
  sessionId: string;
  seq: number;
  serverNow: number;
  phase: VideoDateSnapshotPhase;
  phaseStartedAt: number | null;
  phaseDeadlineAt: number | null;
  allowedActions: string[];
  participants: VideoDateSnapshotParticipant[];
  room: VideoDateSnapshotRoom | null;
  endedReason: string | null;
  endedAt: number | null;
};

export type VideoDateSnapshotError = {
  ok: false;
  error: string;
  retryable?: boolean;
};

export type VideoDateSnapshot = VideoDateSnapshotOk | VideoDateSnapshotError;

export const VIDEO_DATE_SNAPSHOT_FUNCTION_NAME = "video-date-snapshot";

export function normalizeVideoDateSnapshot(payload: unknown): VideoDateSnapshot {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "invalid_snapshot_payload", retryable: true };
  }
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    return {
      ok: false,
      error: typeof record.error === "string" && record.error ? record.error : "snapshot_failed",
      retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
    };
  }

  const roomRecord = record.room && typeof record.room === "object"
    ? record.room as Record<string, unknown>
    : null;
  const sessionId = nullableString(record.sessionId);
  if (!sessionId) {
    return { ok: false, error: "invalid_snapshot_payload", retryable: true };
  }

  return {
    ok: true,
    sessionId,
    seq: numberOrDefault(record.seq, 0),
    serverNow: numberOrDefault(record.serverNow, Date.now()),
    phase: typeof record.phase === "string" ? record.phase : "queued",
    phaseStartedAt: nullableNumber(record.phaseStartedAt),
    phaseDeadlineAt: nullableNumber(record.phaseDeadlineAt),
    allowedActions: Array.isArray(record.allowedActions)
      ? record.allowedActions.filter((action): action is string => typeof action === "string")
      : [],
    participants: Array.isArray(record.participants)
      ? record.participants.map(normalizeParticipant).filter(Boolean) as VideoDateSnapshotParticipant[]
      : [],
    room: roomRecord
      ? {
          name: nullableString(roomRecord.name),
          url: nullableString(roomRecord.url),
          tokenRequired: roomRecord.tokenRequired !== false,
          token: nullableString(roomRecord.token),
          tokenExpiresAt: nullableNumber(roomRecord.tokenExpiresAt),
        }
      : null,
    endedReason: nullableString(record.endedReason),
    endedAt: nullableNumber(record.endedAt),
  };
}

function normalizeParticipant(value: unknown): VideoDateSnapshotParticipant | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    id: nullableString(record.id),
    isSelf: record.isSelf === true,
    isPartner: record.isPartner === true,
    mediaJoinedAt: nullableNumber(record.mediaJoinedAt),
    awayAt: nullableNumber(record.awayAt),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
