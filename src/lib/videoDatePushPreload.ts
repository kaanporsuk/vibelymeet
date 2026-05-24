import {
  normalizeVideoDatePushPreload,
  videoDateTimelineFromPushPreload,
  type VideoDatePushPreload,
} from "@clientShared/matching/videoDatePhase4";
import type { VideoDateTimelineState } from "@clientShared/matching/videoDateTimeline";

const STORAGE_PREFIX = "vibely.videoDate.pushPreload.";

export function rememberVideoDatePushPreloadFromPayload(payload: unknown): VideoDatePushPreload | null {
  const preload = payloadToPreload(payload);
  if (!preload || typeof sessionStorage === "undefined") return preload;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${preload.sessionId}`, JSON.stringify(preload));
  } catch {
    /* best-effort preload only */
  }
  return preload;
}

export function readVideoDatePushPreloadTimeline(sessionId: string | null | undefined): VideoDateTimelineState | null {
  if (!sessionId || typeof sessionStorage === "undefined") return null;
  try {
    const key = `${STORAGE_PREFIX}${sessionId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const preload = normalizeVideoDatePushPreload(JSON.parse(raw));
    const timeline = videoDateTimelineFromPushPreload(preload);
    if (!timeline) sessionStorage.removeItem(key);
    return timeline;
  } catch {
    return null;
  }
}

export function clearVideoDatePushPreload(sessionId: string | null | undefined): void {
  if (!sessionId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`);
  } catch {
    /* best-effort preload only */
  }
}

function payloadToPreload(payload: unknown): VideoDatePushPreload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  return normalizeVideoDatePushPreload(record.video_date_preload) ?? normalizeVideoDatePushPreload(record);
}
