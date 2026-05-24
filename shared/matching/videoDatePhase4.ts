import type { VideoDateTimelineState } from "./videoDateTimeline";

export const VIDEO_DATE_DAILY_TOKEN_PHASE_EXTENSION_BUFFER_MS = 2 * 60 * 1000;
export const VIDEO_DATE_DAILY_TOKEN_RECONNECT_REFRESH_WINDOW_MS = 90 * 1000;
export const VIDEO_DATE_PARTNER_WAIT_MAX_MS = 4 * 60 * 1000;
export const VIDEO_DATE_PUSH_PRELOAD_MAX_BYTES = 3 * 1024;

export type VideoDatePhase4TokenWindowInput = {
  phaseDeadlineAtMs?: number | null;
  dailyRoomExpiresAtIso?: string | null;
  nowMs?: number;
  maxTtlSeconds: number;
  minTtlSeconds?: number;
  extensionBufferMs?: number;
};

export type VideoDatePhase4TokenWindow = {
  ttlSeconds: number;
  expiresAtMs: number;
  expiresAtIso: string;
  reason: "phase_deadline" | "daily_room_expiry" | "max_ttl";
};

export type VideoDatePushPreloadInput = {
  sessionId: string;
  eventId?: string | null;
  state: string;
  phaseDeadlineAtMs?: number | null;
  phaseStartedAtMs?: number | null;
  clockSkewHintMs?: number | null;
  partnerThumbUrl?: string | null;
  correlationId: string;
  dispatchGroupId?: string | null;
  serverNowMs?: number | null;
};

export type VideoDatePushPreload = {
  schema: "video_date_push_preload_v2";
  sessionId: string;
  eventId: string | null;
  state: string;
  phaseDeadlineAtMs: number | null;
  phaseStartedAtMs: number | null;
  clockSkewHintMs: number;
  partnerThumbUrl: string | null;
  correlationId: string;
  dispatchGroupId: string | null;
  serverNowMs: number | null;
};

export function resolveVideoDatePhase4TokenWindow({
  phaseDeadlineAtMs,
  dailyRoomExpiresAtIso,
  nowMs = Date.now(),
  maxTtlSeconds,
  minTtlSeconds = 180,
  extensionBufferMs = VIDEO_DATE_DAILY_TOKEN_PHASE_EXTENSION_BUFFER_MS,
}: VideoDatePhase4TokenWindowInput): VideoDatePhase4TokenWindow {
  const maxTtlMs = Math.max(1, Math.floor(maxTtlSeconds)) * 1000;
  const minTtlMs = Math.max(1, Math.floor(minTtlSeconds)) * 1000;
  const roomExpiresAtMs = parseFiniteMs(dailyRoomExpiresAtIso);
  const phaseDeadlineMs = finitePositiveNumber(phaseDeadlineAtMs);
  const phaseTargetMs =
    phaseDeadlineMs !== null && phaseDeadlineMs > nowMs
      ? phaseDeadlineMs + Math.max(0, extensionBufferMs)
      : null;

  let targetExpiresAtMs = nowMs + maxTtlMs;
  let reason: VideoDatePhase4TokenWindow["reason"] = "max_ttl";
  if (phaseTargetMs !== null) {
    targetExpiresAtMs = phaseTargetMs;
    reason = "phase_deadline";
  } else if (phaseDeadlineMs !== null) {
    targetExpiresAtMs = nowMs + minTtlMs;
    reason = "phase_deadline";
  } else if (roomExpiresAtMs !== null && roomExpiresAtMs > nowMs) {
    targetExpiresAtMs = roomExpiresAtMs;
    reason = "daily_room_expiry";
  }

  targetExpiresAtMs = Math.min(targetExpiresAtMs, nowMs + maxTtlMs);
  if (roomExpiresAtMs !== null && roomExpiresAtMs > nowMs) {
    targetExpiresAtMs = Math.min(targetExpiresAtMs, roomExpiresAtMs);
  }
  if (targetExpiresAtMs <= nowMs + minTtlMs) {
    targetExpiresAtMs = Math.min(nowMs + minTtlMs, roomExpiresAtMs && roomExpiresAtMs > nowMs ? roomExpiresAtMs : nowMs + maxTtlMs);
  }

  const ttlSeconds = Math.max(1, Math.ceil((targetExpiresAtMs - nowMs) / 1000));
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  return {
    ttlSeconds,
    expiresAtMs,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    reason,
  };
}

export function shouldRefreshDailyTokenBeforeReconnect(
  tokenExpiresAtIso: string | null | undefined,
  nowMs = Date.now(),
  refreshWindowMs = VIDEO_DATE_DAILY_TOKEN_RECONNECT_REFRESH_WINDOW_MS,
): boolean {
  if (!tokenExpiresAtIso) return true;
  const expiresAtMs = Date.parse(tokenExpiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= nowMs + Math.max(0, refreshWindowMs);
}

export function createNotificationDispatchGroupId(input: {
  recipientId: string;
  category: string;
  sessionId?: string | null;
  eventId?: string | null;
  dedupeKey?: string | null;
}): string {
  const target = input.dedupeKey || input.sessionId || input.eventId || "global";
  return [
    "vd4",
    sanitizeDispatchPart(input.recipientId),
    sanitizeDispatchPart(input.category),
    sanitizeDispatchPart(target),
  ].join(":").slice(0, 160);
}

export function buildVideoDatePushPreloadData(input: VideoDatePushPreloadInput): Record<string, unknown> {
  const preload = normalizeVideoDatePushPreload({
    schema: "video_date_push_preload_v2",
    sessionId: input.sessionId,
    eventId: input.eventId ?? null,
    state: input.state,
    phaseDeadlineAtMs: nullableFinite(input.phaseDeadlineAtMs),
    phaseStartedAtMs: nullableFinite(input.phaseStartedAtMs),
    clockSkewHintMs: finiteNumber(input.clockSkewHintMs) ?? 0,
    partnerThumbUrl: stringOrNull(input.partnerThumbUrl),
    correlationId: input.correlationId,
    dispatchGroupId: stringOrNull(input.dispatchGroupId),
    serverNowMs: nullableFinite(input.serverNowMs),
  });
  if (!preload) return {};

  const base = {
    video_date_preload: preload,
    phaseDeadlineAt: preload.phaseDeadlineAtMs,
    state: preload.state,
    clockSkewHintMs: preload.clockSkewHintMs,
    partnerThumbUrl: preload.partnerThumbUrl,
    eventId: preload.eventId,
    correlation_id: preload.correlationId,
    dispatch_group_id: preload.dispatchGroupId,
  };
  if (jsonByteLength(base) <= VIDEO_DATE_PUSH_PRELOAD_MAX_BYTES) return base;

  const withoutThumb = {
    ...base,
    partnerThumbUrl: null,
    video_date_preload: {
      ...preload,
      partnerThumbUrl: null,
    },
  };
  if (jsonByteLength(withoutThumb) <= VIDEO_DATE_PUSH_PRELOAD_MAX_BYTES) return withoutThumb;

  return {
    video_date_preload: {
      ...preload,
      partnerThumbUrl: null,
      phaseStartedAtMs: null,
    },
    phaseDeadlineAt: preload.phaseDeadlineAtMs,
    state: preload.state,
    clockSkewHintMs: preload.clockSkewHintMs,
    eventId: preload.eventId,
    correlation_id: preload.correlationId,
    dispatch_group_id: preload.dispatchGroupId,
  };
}

export function normalizeVideoDatePushPreload(value: unknown): VideoDatePushPreload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sessionId = stringOrNull(record.sessionId ?? record.session_id);
  const state = stringOrNull(record.state ?? record.phase);
  const correlationId = stringOrNull(record.correlationId ?? record.correlation_id);
  const dispatchGroupId = stringOrNull(record.dispatchGroupId ?? record.dispatch_group_id);
  if (!sessionId || !state || !correlationId) return null;
  return {
    schema: "video_date_push_preload_v2",
    sessionId,
    eventId: stringOrNull(record.eventId ?? record.event_id),
    state,
    phaseDeadlineAtMs: nullableFinite(record.phaseDeadlineAtMs ?? record.phaseDeadlineAt),
    phaseStartedAtMs: nullableFinite(record.phaseStartedAtMs ?? record.phaseStartedAt),
    clockSkewHintMs: finiteNumber(record.clockSkewHintMs) ?? 0,
    partnerThumbUrl: stringOrNull(record.partnerThumbUrl ?? record.partner_thumb_url),
    correlationId,
    dispatchGroupId,
    serverNowMs: nullableFinite(record.serverNowMs ?? record.serverNow),
  };
}

export function videoDateTimelineFromPushPreload(
  preload: VideoDatePushPreload | null,
  options: { clientNowMs?: number } = {},
): VideoDateTimelineState | null {
  if (!preload) return null;
  const phase = preload.state === "date" ? "date" : preload.state === "handshake" ? "handshake" : null;
  if (!phase || preload.phaseDeadlineAtMs === null) return null;
  const clientNowMs = options.clientNowMs ?? Date.now();
  const serverNowMs = clientNowMs + preload.clockSkewHintMs;
  if (preload.phaseDeadlineAtMs <= serverNowMs) return null;
  const fallbackDurationMs = phase === "handshake" ? 60_000 : 300_000;
  return {
    sessionId: preload.sessionId,
    eventId: preload.eventId,
    seq: 0,
    phase,
    phaseStartedAtMs: preload.phaseStartedAtMs ?? preload.phaseDeadlineAtMs - fallbackDurationMs,
    phaseDeadlineAtMs: preload.phaseDeadlineAtMs,
    serverNowMs,
    clientSyncedAtMs: clientNowMs,
    clockSkewMs: serverNowMs - clientNowMs,
    allowedActions: [],
    endedAtMs: null,
    endedReason: null,
  };
}

export function resolveVideoDatePartnerWaitMaxState(
  waitingStartedAtMs: number | null | undefined,
  nowMs = Date.now(),
  maxWaitMs = VIDEO_DATE_PARTNER_WAIT_MAX_MS,
): { showEscalation: boolean; elapsedMs: number } {
  if (!waitingStartedAtMs || !Number.isFinite(waitingStartedAtMs)) {
    return { showEscalation: false, elapsedMs: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - waitingStartedAtMs);
  return { showEscalation: elapsedMs >= maxWaitMs, elapsedMs };
}

function sanitizeDispatchPart(value: string): string {
  const trimmed = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "_");
  return trimmed || "unknown";
}

function parseFiniteMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finitePositiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function nullableFinite(value: unknown): number | null {
  if (value == null) return null;
  return finiteNumber(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonByteLength(value: unknown): number {
  const text = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}
