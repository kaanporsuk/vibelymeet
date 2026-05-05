import { LobbyPostDateEvents } from "../analytics/lobbyToPostDateJourney";
import type { ReadyGateToDateLatencyCheckpoint } from "./videoDateOperatorMetrics";

export type VideoDateLaunchLatencyPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type VideoDateLaunchLatencyPayload = Record<string, VideoDateLaunchLatencyPayloadValue>;

type SupabaseRpcClient = {
  rpc: (
    fn: "record_video_date_launch_latency_checkpoint",
    args: {
      p_session_id: string;
      p_checkpoint: string;
      p_payload: VideoDateLaunchLatencyPayload;
      p_latency_ms: number | null;
    },
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type EmitVideoDateLaunchLatencyCheckpointInput = {
  client: SupabaseRpcClient;
  eventName: string;
  properties?: Record<string, unknown> | null;
};

export type EmitVideoDateLaunchLatencyCheckpointResult =
  | { ok: true; inserted?: boolean }
  | { ok: false; skipped?: boolean; reason: string };

const ALLOWED_CHECKPOINTS = new Set<ReadyGateToDateLatencyCheckpoint>([
  "ready_gate_impression",
  "ready_tap",
  "ready_gate_transition_started",
  "ready_gate_transition_success",
  "both_ready_observed",
  "room_warmup_started",
  "room_warmup_success",
  "room_warmup_failure",
  "prepare_entry_started",
  "prepare_entry_success",
  "prepare_entry_failure",
  "provider_verify_started",
  "provider_verify_success",
  "provider_verify_skipped",
  "token_created",
  "navigation_started",
  "date_route_entered",
  "video_stage_shell_visible",
  "permission_check_started",
  "permission_check_success",
  "enter_handshake_started",
  "enter_handshake_success",
  "enter_handshake_failure",
  "daily_token_started",
  "daily_token_success",
  "daily_token_failure",
  "daily_join_started",
  "daily_join_success",
  "daily_join_failure",
  "local_video_ready",
  "remote_seen",
  "first_remote_frame",
  "remote_readable",
  "warmup_timer_started",
  "daily_prewarm_started",
  "daily_prewarm_camera_ready",
  "daily_prewarm_preauth_success",
  "daily_prewarm_consumed",
  "daily_prewarm_fallback",
  "daily_prewarm_destroyed",
]);

const SAFE_PAYLOAD_KEYS = new Set([
  "platform",
  "source_surface",
  "source_action",
  "outcome",
  "reason_code",
  "latency_bucket",
  "entry_attempt_id",
  "video_date_trace_id",
  "ready_actor_order",
  "attempt_count",
  "duration_ms",
  "ready_gate_open_to_ready_tap_ms",
  "ready_tap_to_both_ready_ms",
  "ready_tap_to_prepare_entry_ms",
  "ready_tap_to_date_route_ms",
  "ready_tap_to_daily_join_ms",
  "ready_tap_to_remote_seen_ms",
  "ready_tap_to_first_remote_frame_ms",
  "both_ready_to_date_route_ms",
  "both_ready_to_daily_token_ms",
  "both_ready_to_daily_join_ms",
  "both_ready_to_remote_seen_ms",
  "both_ready_to_first_remote_frame_ms",
  "both_ready_to_video_stage_shell_ms",
  "both_ready_to_local_video_ready_ms",
  "date_route_bootstrap_ms",
  "date_route_to_daily_join_ms",
  "daily_join_to_remote_seen_ms",
  "daily_join_to_first_remote_frame_ms",
  "remote_seen_to_first_remote_frame_ms",
  "first_remote_frame_to_readable_ms",
  "daily_token_ms",
  "daily_join_ms",
  "room_warmup_ms",
  "prepare_entry_ms",
  "provider_verify_ms",
  "permission_check_ms",
  "cached_prepare_entry",
  "provider_verify_skipped",
  "permission_handoff_used",
]);

const SAFE_STRING_PATTERN = /^[A-Za-z0-9_.:_-]+$/;
const MAX_SAFE_STRING_LENGTH = 140;
const MAX_SAFE_MS = 24 * 60 * 60 * 1000;
const recentCheckpointKeys = new Map<string, number>();

function isAllowedCheckpoint(value: string): value is ReadyGateToDateLatencyCheckpoint {
  return ALLOWED_CHECKPOINTS.has(value as ReadyGateToDateLatencyCheckpoint);
}

function asSafeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_STRING_LENGTH) return null;
  return SAFE_STRING_PATTERN.test(trimmed) ? trimmed : null;
}

function asSafeNumber(key: string, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (key === "attempt_count") return Math.min(100, Math.max(0, rounded));
  return Math.min(MAX_SAFE_MS, Math.max(0, rounded));
}

function asSafeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function shouldSkipDuplicateCheckpoint(properties: Record<string, unknown>, checkpoint: string): boolean {
  const key = [
    properties.session_id,
    checkpoint,
    properties.source_action,
    properties.outcome,
  ].map((value) => (typeof value === "string" && value.trim() ? value.trim() : "none")).join(":");
  const now = Date.now();
  const seenAt = recentCheckpointKeys.get(key);
  if (seenAt && now - seenAt < 2_000) return true;

  recentCheckpointKeys.set(key, now);
  if (recentCheckpointKeys.size > 256) {
    for (const [seenKey, timestamp] of recentCheckpointKeys) {
      if (now - timestamp > 60_000) recentCheckpointKeys.delete(seenKey);
    }
  }
  return false;
}

export function sanitizeVideoDateLaunchLatencyPayload(
  properties: Record<string, unknown> | null | undefined,
): VideoDateLaunchLatencyPayload {
  const sanitized: VideoDateLaunchLatencyPayload = {};
  if (!properties) return sanitized;

  for (const [key, value] of Object.entries(properties)) {
    if (!SAFE_PAYLOAD_KEYS.has(key) || value === null || value === undefined) continue;

    if (typeof value === "string") {
      const safe = asSafeString(value);
      if (safe !== null) sanitized[key] = safe;
      continue;
    }

    if (typeof value === "number") {
      const safe = asSafeNumber(key, value);
      if (safe !== null) sanitized[key] = safe;
      continue;
    }

    if (typeof value === "boolean") {
      const safe = asSafeBoolean(value);
      if (safe !== null) sanitized[key] = safe;
    }
  }

  return sanitized;
}

function latencyMsForCheckpoint(
  checkpoint: ReadyGateToDateLatencyCheckpoint,
  payload: VideoDateLaunchLatencyPayload,
): number | null {
  if (checkpoint === "first_remote_frame" && typeof payload.ready_tap_to_first_remote_frame_ms === "number") {
    return payload.ready_tap_to_first_remote_frame_ms;
  }
  if (checkpoint === "first_remote_frame") return null;
  return typeof payload.duration_ms === "number" ? payload.duration_ms : null;
}

export async function emitVideoDateLaunchLatencyCheckpointObservability({
  client,
  eventName,
  properties,
}: EmitVideoDateLaunchLatencyCheckpointInput): Promise<EmitVideoDateLaunchLatencyCheckpointResult> {
  if (eventName !== LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT) {
    return { ok: false, skipped: true, reason: "not_launch_latency_checkpoint" };
  }
  if (!properties || typeof properties !== "object") {
    return { ok: false, skipped: true, reason: "missing_properties" };
  }

  const sessionId = asSafeString(properties.session_id);
  const checkpoint = asSafeString(properties.checkpoint);
  if (!sessionId) return { ok: false, skipped: true, reason: "missing_session_id" };
  if (!checkpoint || !isAllowedCheckpoint(checkpoint)) {
    return { ok: false, skipped: true, reason: "unknown_checkpoint" };
  }
  if (shouldSkipDuplicateCheckpoint(properties, checkpoint)) {
    return { ok: false, skipped: true, reason: "deduped" };
  }

  const payload = sanitizeVideoDateLaunchLatencyPayload(properties);
  try {
    const { data, error } = await client.rpc("record_video_date_launch_latency_checkpoint", {
      p_session_id: sessionId,
      p_checkpoint: checkpoint,
      p_payload: payload,
      p_latency_ms: latencyMsForCheckpoint(checkpoint, payload),
    });
    if (error) return { ok: false, reason: error.code ?? error.message ?? "rpc_error" };
    const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return { ok: true, inserted: result.inserted === true };
  } catch {
    return { ok: false, reason: "exception" };
  }
}
