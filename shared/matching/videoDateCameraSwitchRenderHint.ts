export const VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE = "video_date_camera_switch_render_hint" as const;
export const VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION = 1 as const;

export type VideoDateCameraSwitchRenderHintPlatform = "web" | "native";

export type VideoDateCameraSwitchRenderHint = {
  type: typeof VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE;
  version: typeof VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION;
  switchId: string;
  sourcePlatform: VideoDateCameraSwitchRenderHintPlatform;
  facingMode: string | null;
  commitConfirmed?: boolean;
  commitMethod?: string | null;
  localVideoTrackId?: string | null;
  commitLatencyMs?: number | null;
  publishSequence?: number | null;
  publishRefreshApplied?: boolean;
  hintSequence?: number | null;
  sentAtMs: number;
};

type CreateVideoDateCameraSwitchRenderHintInput = {
  sourcePlatform: VideoDateCameraSwitchRenderHintPlatform;
  facingMode?: string | null;
  commitConfirmed?: boolean;
  commitMethod?: string | null;
  localVideoTrackId?: string | null;
  commitLatencyMs?: number | null;
  publishSequence?: number | null;
  publishRefreshApplied?: boolean;
  hintSequence?: number | null;
  sentAtMs?: number;
  random?: () => number;
};

function isVideoDateCameraSwitchRenderHintPlatform(
  value: unknown
): value is VideoDateCameraSwitchRenderHintPlatform {
  return value === "web" || value === "native";
}

function makeVideoDateCameraSwitchRenderHintId(
  sentAtMs: number,
  random: () => number = Math.random
): string {
  const randomValue = random();
  const safeRandom = Number.isFinite(randomValue) ? randomValue : Math.random();
  return `${sentAtMs.toString(36)}-${Math.abs(safeRandom).toString(36).slice(2, 10)}`;
}

export function createVideoDateCameraSwitchRenderHint({
  sourcePlatform,
  facingMode = null,
  commitConfirmed = true,
  commitMethod = null,
  localVideoTrackId = null,
  commitLatencyMs = null,
  publishSequence = null,
  publishRefreshApplied = false,
  hintSequence = 1,
  sentAtMs = Date.now(),
  random = Math.random,
}: CreateVideoDateCameraSwitchRenderHintInput): VideoDateCameraSwitchRenderHint {
  return {
    type: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE,
    version: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION,
    switchId: makeVideoDateCameraSwitchRenderHintId(sentAtMs, random),
    sourcePlatform,
    facingMode: typeof facingMode === "string" && facingMode.trim() ? facingMode.trim() : null,
    commitConfirmed,
    commitMethod: typeof commitMethod === "string" && commitMethod.trim() ? commitMethod.trim() : null,
    localVideoTrackId:
      typeof localVideoTrackId === "string" && localVideoTrackId.trim() ? localVideoTrackId.trim() : null,
    commitLatencyMs:
      typeof commitLatencyMs === "number" && Number.isFinite(commitLatencyMs) && commitLatencyMs >= 0
        ? Math.round(commitLatencyMs)
        : null,
    publishSequence:
      typeof publishSequence === "number" && Number.isFinite(publishSequence) && publishSequence > 0
        ? Math.round(publishSequence)
        : null,
    publishRefreshApplied: publishRefreshApplied === true,
    hintSequence:
      typeof hintSequence === "number" && Number.isFinite(hintSequence) && hintSequence > 0
        ? Math.round(hintSequence)
        : null,
    sentAtMs,
  };
}

export function parseVideoDateCameraSwitchRenderHint(
  value: unknown
): VideoDateCameraSwitchRenderHint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE) return null;
  if (raw.version !== VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION) return null;
  if (typeof raw.switchId !== "string" || !raw.switchId.trim() || raw.switchId.length > 96) {
    return null;
  }
  if (!isVideoDateCameraSwitchRenderHintPlatform(raw.sourcePlatform)) return null;
  if (raw.facingMode != null && typeof raw.facingMode !== "string") return null;
  if (raw.commitConfirmed != null && typeof raw.commitConfirmed !== "boolean") return null;
  if (raw.commitMethod != null && typeof raw.commitMethod !== "string") return null;
  if (raw.localVideoTrackId != null && typeof raw.localVideoTrackId !== "string") return null;
  if (
    raw.commitLatencyMs != null &&
    (typeof raw.commitLatencyMs !== "number" || !Number.isFinite(raw.commitLatencyMs) || raw.commitLatencyMs < 0)
  ) {
    return null;
  }
  if (
    raw.publishSequence != null &&
    (typeof raw.publishSequence !== "number" || !Number.isFinite(raw.publishSequence) || raw.publishSequence <= 0)
  ) {
    return null;
  }
  if (raw.publishRefreshApplied != null && typeof raw.publishRefreshApplied !== "boolean") return null;
  if (
    raw.hintSequence != null &&
    (typeof raw.hintSequence !== "number" || !Number.isFinite(raw.hintSequence) || raw.hintSequence <= 0)
  ) {
    return null;
  }
  if (typeof raw.sentAtMs !== "number" || !Number.isFinite(raw.sentAtMs) || raw.sentAtMs <= 0) {
    return null;
  }

  return {
    type: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE,
    version: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION,
    switchId: raw.switchId.trim(),
    sourcePlatform: raw.sourcePlatform,
    facingMode: typeof raw.facingMode === "string" && raw.facingMode.trim() ? raw.facingMode.trim() : null,
    commitConfirmed: raw.commitConfirmed === true,
    commitMethod: typeof raw.commitMethod === "string" && raw.commitMethod.trim() ? raw.commitMethod.trim() : null,
    localVideoTrackId:
      typeof raw.localVideoTrackId === "string" && raw.localVideoTrackId.trim()
        ? raw.localVideoTrackId.trim()
        : null,
    commitLatencyMs: typeof raw.commitLatencyMs === "number" ? Math.round(raw.commitLatencyMs) : null,
    publishSequence: typeof raw.publishSequence === "number" ? Math.round(raw.publishSequence) : null,
    publishRefreshApplied: raw.publishRefreshApplied === true,
    hintSequence: typeof raw.hintSequence === "number" ? Math.round(raw.hintSequence) : null,
    sentAtMs: raw.sentAtMs,
  };
}
