import {
  normalizeVideoDatePushPreload,
  videoDateTimelineFromPushPreload,
  type VideoDatePushPreload,
} from '@clientShared/matching/videoDatePhase4';
import type { VideoDateTimelineState } from '@clientShared/matching/videoDateTimeline';

const preloadBySessionId = new Map<string, VideoDatePushPreload>();

export function rememberVideoDatePushPreloadFromPayload(payload: unknown): VideoDatePushPreload | null {
  const preload = payloadToPreload(payload);
  if (preload) preloadBySessionId.set(preload.sessionId, preload);
  return preload;
}

export function readVideoDatePushPreloadTimeline(sessionId: string | null | undefined): VideoDateTimelineState | null {
  if (!sessionId) return null;
  const timeline = videoDateTimelineFromPushPreload(preloadBySessionId.get(sessionId) ?? null);
  if (!timeline) preloadBySessionId.delete(sessionId);
  return timeline;
}

export function clearVideoDatePushPreload(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  preloadBySessionId.delete(sessionId);
}

function payloadToPreload(payload: unknown): VideoDatePushPreload | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  return normalizeVideoDatePushPreload(record.video_date_preload) ?? normalizeVideoDatePushPreload(record);
}
