import { bucketVideoDateLatencyMs, type VideoDateLatencyBucket } from "./videoDateOperatorMetrics";

export const VIDEO_DATE_CLIENT_STUCK_OBSERVABILITY_OPERATION = "video_date_client_stuck_state";

export const VIDEO_DATE_CLIENT_STUCK_EVENT_NAMES = [
  "ready_gate_handoff_slow",
  "prepare_date_entry_failed",
  "daily_join_confirmation_failed",
  "peer_missing_terminal",
  "peer_missing_suppressed_remote_seen",
  "peer_missing_suppressed_survey_truth",
  "native_background_recovery_started",
  "native_background_recovery_failed",
  "native_background_expired",
] as const;

export type VideoDateClientStuckEventName =
  (typeof VIDEO_DATE_CLIENT_STUCK_EVENT_NAMES)[number];

export type VideoDateClientStuckPlatform = "web" | "native";

export type VideoDateClientStuckPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type VideoDateClientStuckPayload = Record<string, VideoDateClientStuckPayloadValue>;

type SupabaseRpcClient = {
  rpc: (
    fn: "record_video_date_client_stuck_observability",
    args: {
      p_session_id: string;
      p_event_name: string;
      p_payload: VideoDateClientStuckPayload;
      p_latency_ms: number | null;
    },
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type EmitVideoDateClientStuckObservabilityInput = {
  client: SupabaseRpcClient;
  sessionId: string | null | undefined;
  eventName: VideoDateClientStuckEventName;
  payload?: VideoDateClientStuckPayload | null;
  latencyMs?: number | null;
  dedupe?: boolean;
};

export type EmitVideoDateClientStuckObservabilityResult =
  | { ok: true; inserted?: boolean; deduped?: boolean }
  | { ok: false; skipped?: boolean; reason: string };

const SAFE_PAYLOAD_KEYS = new Set([
  "platform",
  "source",
  "source_surface",
  "source_action",
  "reason_code",
  "code",
  "phase",
  "latency_bucket",
  "entry_attempt_id",
  "video_date_trace_id",
  "attempt",
  "attempt_count",
  "elapsed_ms",
  "duration_ms",
  "grace_ms",
  "watchdog_ms",
  "auto_recovery_count",
  "http_status",
  "retryable",
  "exhausted",
  "will_retry",
]);

const SAFE_STRING_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const MAX_SAFE_STRING_LENGTH = 120;
const MAX_SAFE_MS = 24 * 60 * 60 * 1000;
const emittedKeys = new Set<string>();

function isAllowedVideoDateClientStuckEventName(
  eventName: string,
): eventName is VideoDateClientStuckEventName {
  return VIDEO_DATE_CLIENT_STUCK_EVENT_NAMES.includes(eventName as VideoDateClientStuckEventName);
}

function sanitizeString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_STRING_LENGTH) return null;
  return SAFE_STRING_PATTERN.test(trimmed) ? trimmed : null;
}

function sanitizeNumber(key: string, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (key === "attempt" || key === "attempt_count" || key === "auto_recovery_count") {
    return Math.min(100, Math.max(0, rounded));
  }
  if (key === "http_status") {
    return rounded >= 100 && rounded <= 599 ? rounded : null;
  }
  return Math.min(MAX_SAFE_MS, Math.max(0, rounded));
}

export function sanitizeVideoDateClientStuckPayload(
  payload: VideoDateClientStuckPayload | null | undefined,
): VideoDateClientStuckPayload {
  const sanitized: VideoDateClientStuckPayload = {};
  if (!payload) return sanitized;

  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_PAYLOAD_KEYS.has(key) || value === null || value === undefined) continue;

    if (typeof value === "string") {
      const safe = sanitizeString(value);
      if (safe !== null) sanitized[key] = safe;
      continue;
    }

    if (typeof value === "number") {
      const safe = sanitizeNumber(key, value);
      if (safe !== null) sanitized[key] = safe;
      continue;
    }

    if (typeof value === "boolean") {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function buildVideoDateClientStuckPayload({
  platform,
  sourceSurface,
  sourceAction,
  reasonCode,
  latencyMs,
  extra,
}: {
  platform: VideoDateClientStuckPlatform;
  sourceSurface: string;
  sourceAction: string;
  reasonCode?: string | null;
  latencyMs?: number | null;
  extra?: VideoDateClientStuckPayload | null;
}): VideoDateClientStuckPayload {
  const latencyBucket: VideoDateLatencyBucket | null =
    typeof latencyMs === "number" && Number.isFinite(latencyMs)
      ? bucketVideoDateLatencyMs(latencyMs)
      : null;

  return sanitizeVideoDateClientStuckPayload({
    platform,
    source_surface: sourceSurface,
    source_action: sourceAction,
    reason_code: reasonCode ?? undefined,
    duration_ms: latencyMs ?? undefined,
    latency_bucket: latencyBucket ?? undefined,
    ...(extra ?? {}),
  });
}

export function makeVideoDateClientStuckDedupeKey(
  sessionId: string,
  eventName: VideoDateClientStuckEventName,
): string {
  return `${sessionId}:${eventName}`;
}

export function clearVideoDateClientStuckObservabilityDedupeForTests() {
  emittedKeys.clear();
}

export async function emitVideoDateClientStuckObservability({
  client,
  sessionId,
  eventName,
  payload,
  latencyMs,
  dedupe = true,
}: EmitVideoDateClientStuckObservabilityInput): Promise<EmitVideoDateClientStuckObservabilityResult> {
  if (!sessionId || typeof sessionId !== "string") {
    return { ok: false, skipped: true, reason: "missing_session_id" };
  }
  if (!isAllowedVideoDateClientStuckEventName(eventName)) {
    return { ok: false, skipped: true, reason: "unknown_event_name" };
  }

  const dedupeKey = makeVideoDateClientStuckDedupeKey(sessionId, eventName);
  if (dedupe && emittedKeys.has(dedupeKey)) {
    return { ok: false, skipped: true, reason: "deduped" };
  }
  if (dedupe) emittedKeys.add(dedupeKey);

  const safeLatencyMs =
    typeof latencyMs === "number" && Number.isFinite(latencyMs)
      ? Math.min(MAX_SAFE_MS, Math.max(0, Math.round(latencyMs)))
      : null;

  try {
    const { data, error } = await client.rpc("record_video_date_client_stuck_observability", {
      p_session_id: sessionId,
      p_event_name: eventName,
      p_payload: sanitizeVideoDateClientStuckPayload(payload),
      p_latency_ms: safeLatencyMs,
    });
    if (error) return { ok: false, reason: error.code ?? error.message ?? "rpc_error" };
    const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return {
      ok: true,
      inserted: result.inserted === true,
      deduped: result.deduped === true,
    };
  } catch {
    return { ok: false, reason: "exception" };
  }
}
