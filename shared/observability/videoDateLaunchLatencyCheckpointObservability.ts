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
    fn: "record_video_date_launch_latency_checkpoint" | "record_video_date_launch_latency_checkpoints_v1",
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type EmitVideoDateLaunchLatencyCheckpointInput = {
  client: SupabaseRpcClient;
  eventName: string;
  properties?: Record<string, unknown> | null;
};

export type EmitVideoDateLaunchLatencyCheckpointResult =
  | { ok: true; inserted?: boolean; queued?: boolean }
  | { ok: false; skipped?: boolean; reason: string };

const ALLOWED_CHECKPOINTS = new Set<ReadyGateToDateLatencyCheckpoint>([
  "swipe_result",
  "ready_gate_impression",
  "ready_tap",
  "ready_gate_transition_started",
  "ready_gate_transition_success",
  "both_ready_observed",
  "both_ready_observed_via_rpc_short_circuit",
  "mutual_swipe_observed",
  "room_pre_create_started",
  "room_pre_create_success",
  "room_pre_create_failure",
  "daily_room_create_started",
  "daily_room_create_success",
  "daily_room_create_failure",
  "prepare_entry_started",
  "prepare_entry_success",
  "prepare_entry_failure",
  "provider_verify_started",
  "provider_verify_success",
  "provider_verify_skipped",
  "token_created",
  "navigation_started",
  "date_route_entered",
  "date_route_module_preloaded",
  "video_stage_shell_visible",
  "permission_check_started",
  "permission_check_success",
  "permission_check_skipped",
  "daily_token_started",
  "daily_token_success",
  "daily_token_failure",
  "daily_token_mint_started",
  "daily_token_mint_success",
  "daily_token_mint_failure",
  "daily_join_started",
  "daily_join_success",
  "daily_join_failure",
  "daily_reconnect_started",
  "daily_reconnect_success",
  "daily_reconnect_failure",
  "extension_refresh_started",
  "extension_refresh_success",
  "extension_refresh_failure",
  "local_video_ready",
  "remote_seen",
  "first_remote_frame",
  "remote_readable",
  "warmup_timer_started",
  "daily_prewarm_started",
  "daily_prewarm_camera_ready",
  "daily_prewarm_preauth_success",
  "daily_prewarm_join_started",
  "daily_prewarm_join_success",
  "daily_prewarm_join_failure",
  "daily_prewarm_consumed",
  "daily_prewarm_fallback",
  "daily_prewarm_destroyed",
  "video_date_route_preload_started",
  "video_date_route_preload_success",
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
  "swipe_result_ms",
  "ready_gate_open_to_ready_tap_ms",
  "ready_tap_to_both_ready_ms",
  "ready_tap_to_prepare_entry_ms",
  "mutual_swipe_to_room_ready_ms",
  "human_wait_swipe_to_both_ready_ms",
  "system_latency_both_ready_to_first_remote_frame_ms",
  "date_route_module_preload_ms",
  "eligible_pre_create_status",
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
  "edge_cold_start_ms",
  "edge_process_uptime_ms",
  "edge_total_ms",
  "daily_performance_segment",
  "daily_room_create_ms",
  "daily_token_mint_ms",
  "daily_reconnect_ms",
  "extension_refresh_ms",
  "prepare_entry_ms",
  "auth_ms",
  "prepare_rpc_ms",
  "room_create_or_verify_ms",
  "token_ms",
  "confirm_prepare_ms",
  "provider_verify_ms",
  "provider_verify_reason",
  "extension_mode",
  "credit_type",
  "extension_mutual",
  "extension_awaiting_partner",
  "extension_applied",
  "reconnect_source",
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
  if (checkpoint === "swipe_result" && typeof payload.swipe_result_ms === "number") {
    return payload.swipe_result_ms;
  }
  if (checkpoint === "room_pre_create_success" && typeof payload.mutual_swipe_to_room_ready_ms === "number") {
    return payload.mutual_swipe_to_room_ready_ms;
  }
  if (
    (checkpoint === "daily_room_create_success" || checkpoint === "daily_room_create_failure") &&
    typeof payload.daily_room_create_ms === "number"
  ) {
    return payload.daily_room_create_ms;
  }
  if (
    (checkpoint === "daily_token_mint_success" || checkpoint === "daily_token_mint_failure") &&
    typeof payload.daily_token_mint_ms === "number"
  ) {
    return payload.daily_token_mint_ms;
  }
  if (
    (checkpoint === "daily_reconnect_success" || checkpoint === "daily_reconnect_failure") &&
    typeof payload.daily_reconnect_ms === "number"
  ) {
    return payload.daily_reconnect_ms;
  }
  if (
    (checkpoint === "extension_refresh_success" || checkpoint === "extension_refresh_failure") &&
    typeof payload.extension_refresh_ms === "number"
  ) {
    return payload.extension_refresh_ms;
  }
  if (checkpoint === "date_route_module_preloaded" && typeof payload.date_route_module_preload_ms === "number") {
    return payload.date_route_module_preload_ms;
  }
  if (checkpoint === "daily_join_success" && typeof payload.date_route_to_daily_join_ms === "number") {
    return payload.date_route_to_daily_join_ms;
  }
  if (checkpoint === "daily_join_success" && typeof payload.ready_tap_to_daily_join_ms === "number") {
    return payload.ready_tap_to_daily_join_ms;
  }
  if (checkpoint === "remote_seen" && typeof payload.daily_join_to_remote_seen_ms === "number") {
    return payload.daily_join_to_remote_seen_ms;
  }
  if (checkpoint === "remote_seen" && typeof payload.ready_tap_to_remote_seen_ms === "number") {
    return payload.ready_tap_to_remote_seen_ms;
  }
  if (checkpoint === "first_remote_frame" && typeof payload.ready_tap_to_first_remote_frame_ms === "number") {
    return payload.ready_tap_to_first_remote_frame_ms;
  }
  if (checkpoint === "first_remote_frame") return null;
  if (checkpoint === "remote_readable" && typeof payload.first_remote_frame_to_readable_ms === "number") {
    return payload.first_remote_frame_to_readable_ms;
  }
  return typeof payload.duration_ms === "number" ? payload.duration_ms : null;
}

// Golden-flow lean pass: checkpoints are operational telemetry, not critical
// state. A single launch emits ~30 checkpoints; firing one RPC per checkpoint
// made this the #2 cumulative DB consumer and added ~30 round trips to every
// launch. Checkpoints are now buffered per session and flushed in ONE batch
// RPC (record_video_date_launch_latency_checkpoints_v1) when the buffer is
// 1.5s old or reaches 10 items. Failure checkpoints and first_remote_frame
// flush immediately so incident forensics stay prompt. A failed batch flush
// falls back to the original single-checkpoint RPC per item. Worst case on
// abrupt tab close: <=1.5s of non-critical checkpoints are lost.
const CHECKPOINT_FLUSH_DELAY_MS = 1_500;
const CHECKPOINT_FLUSH_MAX_BUFFER = 10;
const CHECKPOINT_BATCH_RPC = "record_video_date_launch_latency_checkpoints_v1" as const;

type BufferedCheckpoint = {
  checkpoint: string;
  payload: VideoDateLaunchLatencyPayload;
  latency_ms: number | null;
};

type CheckpointBuffer = {
  client: SupabaseRpcClient;
  items: BufferedCheckpoint[];
  timer: ReturnType<typeof setTimeout> | null;
};

const checkpointBuffers = new Map<string, CheckpointBuffer>();

function shouldFlushImmediately(checkpoint: string): boolean {
  return checkpoint.endsWith("_failure") || checkpoint === "first_remote_frame";
}

function isLaunchLatencyBatchFailure(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const payload = data as { ok?: unknown; success?: unknown };
  return payload.ok === false || payload.success === false;
}

async function flushCheckpointBuffer(sessionId: string): Promise<void> {
  const buffer = checkpointBuffers.get(sessionId);
  if (!buffer || buffer.items.length === 0) return;
  checkpointBuffers.delete(sessionId);
  if (buffer.timer) clearTimeout(buffer.timer);

  const items = buffer.items;
  try {
    const { data, error } = await buffer.client.rpc(CHECKPOINT_BATCH_RPC, {
      p_session_id: sessionId,
      p_checkpoints: items,
    });
    if (!error && !isLaunchLatencyBatchFailure(data)) return;
  } catch {
    /* fall through to single-call fallback */
  }

  for (const item of items) {
    try {
      await buffer.client.rpc("record_video_date_launch_latency_checkpoint", {
        p_session_id: sessionId,
        p_checkpoint: item.checkpoint,
        p_payload: item.payload,
        p_latency_ms: item.latency_ms,
      });
    } catch {
      /* observability must never throw into the golden flow */
    }
  }
}

export async function flushVideoDateLaunchLatencyCheckpoints(sessionId?: string): Promise<void> {
  if (sessionId) {
    await flushCheckpointBuffer(sessionId);
    return;
  }
  await Promise.all([...checkpointBuffers.keys()].map((key) => flushCheckpointBuffer(key)));
}

function enqueueCheckpoint(
  client: SupabaseRpcClient,
  sessionId: string,
  item: BufferedCheckpoint,
): void {
  let buffer = checkpointBuffers.get(sessionId);
  if (!buffer) {
    buffer = { client, items: [], timer: null };
    checkpointBuffers.set(sessionId, buffer);
  }
  buffer.client = client;
  buffer.items.push(item);

  if (shouldFlushImmediately(item.checkpoint) || buffer.items.length >= CHECKPOINT_FLUSH_MAX_BUFFER) {
    void flushCheckpointBuffer(sessionId);
    return;
  }
  if (!buffer.timer) {
    buffer.timer = setTimeout(() => {
      void flushCheckpointBuffer(sessionId);
    }, CHECKPOINT_FLUSH_DELAY_MS);
  }
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
    enqueueCheckpoint(client, sessionId, {
      checkpoint,
      payload,
      latency_ms: latencyMsForCheckpoint(checkpoint, payload),
    });
    return { ok: true, queued: true };
  } catch {
    return { ok: false, reason: "exception" };
  }
}
