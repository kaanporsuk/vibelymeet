export const VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE = "video_date_camera_switch_render_hint" as const;
export const VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION = 1 as const;

export type VideoDateCameraSwitchRenderHintPlatform = "web" | "native";

export type VideoDateCameraSwitchRenderHint = {
  type: typeof VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE;
  version: typeof VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION;
  switchId: string;
  sourcePlatform: VideoDateCameraSwitchRenderHintPlatform;
  facingMode: string | null;
  sentAtMs: number;
};

type CreateVideoDateCameraSwitchRenderHintInput = {
  sourcePlatform: VideoDateCameraSwitchRenderHintPlatform;
  facingMode?: string | null;
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
  sentAtMs = Date.now(),
  random = Math.random,
}: CreateVideoDateCameraSwitchRenderHintInput): VideoDateCameraSwitchRenderHint {
  return {
    type: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE,
    version: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION,
    switchId: makeVideoDateCameraSwitchRenderHintId(sentAtMs, random),
    sourcePlatform,
    facingMode: typeof facingMode === "string" && facingMode.trim() ? facingMode.trim() : null,
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
  if (typeof raw.sentAtMs !== "number" || !Number.isFinite(raw.sentAtMs) || raw.sentAtMs <= 0) {
    return null;
  }

  return {
    type: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE,
    version: VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION,
    switchId: raw.switchId.trim(),
    sourcePlatform: raw.sourcePlatform,
    facingMode: typeof raw.facingMode === "string" && raw.facingMode.trim() ? raw.facingMode.trim() : null,
    sentAtMs: raw.sentAtMs,
  };
}
