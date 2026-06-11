import { normalizeVideoDateEntryPhase } from "./videoDateEntryCompatibility";

export type VideoDateSnapshotPhase =
  | "ready_gate"
  | "entry"
  | "date"
  | "verdict"
  | "ended"
  | string;

export type VideoDateSnapshotParticipant = {
  id: string | null;
  isSelf: boolean;
  isPartner: boolean;
  mediaJoinedAt: number | null;
  remoteSeenAt?: number | null;
  awayAt: number | null;
};

export type VideoDateSnapshotRoom = {
  name: string | null;
  url: string | null;
  tokenRequired: boolean;
  token?: string | null;
  tokenExpiresAt?: number | null;
  tokenTtlSeconds?: number | null;
  tokenExpiryReason?: string | null;
};

export type VideoDateSnapshotOk = {
  ok: true;
  sessionId: string;
  eventId: string | null;
  seq: number;
  serverNow: number;
  phase: VideoDateSnapshotPhase;
  phaseStartedAt: number | null;
  phaseDeadlineAt: number | null;
  allowedActions: string[];
  surveyRequired?: boolean | null;
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
    eventId: nullableString(record.eventId),
    seq: numberOrDefault(record.seq, 0),
    serverNow: numberOrDefault(record.serverNow, Date.now()),
    phase: normalizeVideoDateSnapshotPhase(record.phase),
    phaseStartedAt: nullableNumber(record.phaseStartedAt),
    phaseDeadlineAt: nullableNumber(record.phaseDeadlineAt),
    allowedActions: Array.isArray(record.allowedActions)
      ? record.allowedActions.filter((action): action is string => typeof action === "string")
      : [],
    surveyRequired: typeof record.surveyRequired === "boolean"
      ? record.surveyRequired
      : typeof record.survey_required === "boolean"
        ? record.survey_required
        : null,
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
          tokenTtlSeconds: nullableNumber(roomRecord.tokenTtlSeconds),
          tokenExpiryReason: nullableString(roomRecord.tokenExpiryReason),
        }
      : null,
    endedReason: nullableString(record.endedReason),
    endedAt: nullableNumber(record.endedAt),
  };
}

type SnapshotInvokeErrorResponseLike = {
  clone?: () => SnapshotInvokeErrorResponseLike;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export async function normalizeVideoDateSnapshotInvokeError(error: unknown): Promise<VideoDateSnapshotError> {
  const response = snapshotInvokeErrorResponse(error);
  if (response) {
    const payload = await readSnapshotInvokeErrorPayload(response);
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (record.ok === false || typeof record.error === "string") {
        const normalized = normalizeVideoDateSnapshot(payload);
        if (normalized.ok === false) return normalized;
      }
    }
  }
  return { ok: false, error: "snapshot_function_failed", retryable: true };
}

function snapshotInvokeErrorResponse(error: unknown): SnapshotInvokeErrorResponseLike | null {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const response = context as SnapshotInvokeErrorResponseLike;
  return typeof response.clone === "function" ||
    typeof response.json === "function" ||
    typeof response.text === "function"
    ? response
    : null;
}

async function readSnapshotInvokeErrorPayload(response: SnapshotInvokeErrorResponseLike): Promise<unknown> {
  if (typeof response.json === "function") {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    try {
      return await readable.json?.();
    } catch {
      // Try text below when a clone is available; otherwise the body may be consumed.
    }
  }
  if (typeof response.text === "function") {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    try {
      const text = await readable.text?.();
      return text?.trim() ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeParticipant(value: unknown): VideoDateSnapshotParticipant | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    id: nullableString(record.id),
    isSelf: record.isSelf === true,
    isPartner: record.isPartner === true,
    mediaJoinedAt: nullableNumber(record.mediaJoinedAt),
    remoteSeenAt: nullableNumber(record.remoteSeenAt),
    awayAt: nullableNumber(record.awayAt),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeVideoDateSnapshotPhase(value: unknown): VideoDateSnapshotPhase {
  const entryPhase = normalizeVideoDateEntryPhase(value);
  if (entryPhase === "entry") return "entry";
  return typeof value === "string" ? value : "ready_gate";
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
