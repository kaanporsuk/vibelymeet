import {
  getVideoDateDeckPrefetchItems,
} from '@clientShared/matching/videoDateDeckPrefetch';
import { VIDEO_DATE_DECK_BUFFER_LIMIT } from '@clientShared/matching/videoDateInstantExperience';
import {
  normalizeVideoDatePushPreload,
  videoDateTimelineFromPushPreload,
  type VideoDatePushPreload,
} from '@clientShared/matching/videoDatePhase4';
import type { VideoDateTimelineState } from '@clientShared/matching/videoDateTimeline';
import { parseEventDeckResponse } from '@shared/eventProfileAdapters';
import { Image } from 'react-native';
import { deckCardUrl } from '@/lib/imageUrl';
import { getCachedUserId } from '@/lib/nativeAuthSession';
import { supabase } from '@/lib/supabase';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';

const preloadBySessionId = new Map<string, VideoDatePushPreload>();
export const VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS = 5_000;
const PUSH_DECK_PREFETCH_MEDIA_LIMIT = 3;

export function rememberVideoDatePushPreloadFromPayload(payload: unknown): VideoDatePushPreload | null {
  const preload = payloadToPreload(payload);
  if (preload) preloadBySessionId.set(preload.sessionId, preload);
  return preload;
}

export function preloadVideoDatePushTargetsFromPayload(payload: unknown, viewerId?: string | null): void {
  void withTimeout(preloadVideoDatePushTargets(payload, viewerId), VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS);
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

function pushTargetString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function payloadToPreloadTargets(payload: unknown): { sessionId: string | null; eventId: string | null } {
  if (!payload || typeof payload !== 'object') return { sessionId: null, eventId: null };
  const record = payload as Record<string, unknown>;
  const preload = record.video_date_preload && typeof record.video_date_preload === 'object'
    ? record.video_date_preload as Record<string, unknown>
    : {};
  return {
    sessionId:
      pushTargetString(record.video_session_id) ??
      pushTargetString(record.session_id) ??
      pushTargetString(record.sessionId) ??
      pushTargetString(preload.sessionId) ??
      pushTargetString(preload.session_id),
    eventId:
      pushTargetString(record.event_id) ??
      pushTargetString(record.eventId) ??
      pushTargetString(preload.eventId) ??
      pushTargetString(preload.event_id),
  };
}

async function preloadVideoDatePushTargets(payload: unknown, viewerId?: string | null): Promise<void> {
  const preload = rememberVideoDatePushPreloadFromPayload(payload);
  const targets = payloadToPreloadTargets(payload);
  const sessionId = targets.sessionId ?? preload?.sessionId ?? null;
  const eventId = targets.eventId ?? preload?.eventId ?? null;
  const viewer = viewerId ?? await getCachedUserId();
  await Promise.allSettled([
    sessionId ? fetchVideoDateSnapshot(sessionId, { includeToken: false }) : Promise.resolve(null),
    eventId && viewer ? preloadEventDeckAndTopMedia(eventId, viewer) : Promise.resolve(null),
  ]);
}

async function preloadEventDeckAndTopMedia(eventId: string, viewerId: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('get_event_deck' as never, {
      p_event_id: eventId,
      p_user_id: viewerId,
      p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT,
    } as never);
    if (error) return;
    const deck = parseEventDeckResponse(data);
    const media = getVideoDateDeckPrefetchItems(deck.profiles, PUSH_DECK_PREFETCH_MEDIA_LIMIT);
    await Promise.allSettled(media.map((item) => Image.prefetch(deckCardUrl(item.source, item.mediaVersion))));
  } catch {
    /* best-effort push preload only */
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
