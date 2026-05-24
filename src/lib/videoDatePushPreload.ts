import {
  VIDEO_DATE_DECK_BUFFER_LIMIT,
} from "@clientShared/matching/videoDateInstantExperience";
import {
  getVideoDateDeckPrefetchItems,
} from "@clientShared/matching/videoDateDeckPrefetch";
import {
  normalizeVideoDatePushPreload,
  videoDateTimelineFromPushPreload,
  type VideoDatePushPreload,
} from "@clientShared/matching/videoDatePhase4";
import type { VideoDateTimelineState } from "@clientShared/matching/videoDateTimeline";
import { adviseVideoDateSnapshotRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import { parseEventDeckResponse } from "@shared/eventProfileAdapters";
import { supabase } from "@/integrations/supabase/client";
import { deckCardUrl } from "@/utils/imageUrl";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";

const STORAGE_PREFIX = "vibely.videoDate.pushPreload.";
export const VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS = 5_000;
export const VIDEO_DATE_PUSH_CANONICAL_NAV_TIMEOUT_MS = 2_500;
const PUSH_DECK_PREFETCH_MEDIA_LIMIT = 3;

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

export function preloadVideoDatePushTargetsFromPayload(payload: unknown, viewerId?: string | null): void {
  void withTimeout(preloadVideoDatePushTargets(payload, viewerId), VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS);
}

export async function resolveVideoDatePushHrefFromCanonicalTruth(rawHref: unknown): Promise<string | null> {
  const href = pushTargetString(rawHref);
  if (!href) return null;
  const path = appPathFromHref(href);
  const match = path?.match(/^\/(date|ready)\/([^/?#]+)/);
  if (!match) return href;
  const sessionId = decodeURIComponent(match[2]);
  if (!sessionId) return href;

  const snapshot = await withTimeout(fetchVideoDateSnapshot(sessionId, { includeToken: false }), VIDEO_DATE_PUSH_CANONICAL_NAV_TIMEOUT_MS);
  if (!snapshot) return href;
  const recovery = adviseVideoDateSnapshotRecovery(snapshot, {
    expectedSessionId: sessionId,
    platform: "web",
    surface: "notification_deep_link",
  });
  if (recovery.action === "go_date" || recovery.action === "go_survey") return `/date/${encodeURIComponent(recovery.sessionId)}`;
  if (recovery.action === "go_ready_gate") return `/ready/${encodeURIComponent(recovery.sessionId)}`;
  if (recovery.action === "go_lobby") return `/event/${encodeURIComponent(recovery.eventId)}/lobby`;
  if (recovery.action === "go_home" || recovery.action === "invalid") return "/events";
  return href;
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

function appPathFromHref(raw: string): string | null {
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
    if (url.origin !== currentOrigin && url.origin !== "https://www.vibelymeet.com") return null;
    return `${url.pathname || "/"}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function pushTargetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadToPreloadTargets(payload: unknown): { sessionId: string | null; eventId: string | null } {
  if (!payload || typeof payload !== "object") return { sessionId: null, eventId: null };
  const record = payload as Record<string, unknown>;
  const preload = record.video_date_preload && typeof record.video_date_preload === "object"
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
  const viewer = viewerId ?? await currentViewerId();
  await Promise.allSettled([
    sessionId ? fetchVideoDateSnapshot(sessionId, { includeToken: false }) : Promise.resolve(null),
    eventId && viewer ? preloadEventDeckAndTopMedia(eventId, viewer) : Promise.resolve(null),
  ]);
}

async function currentViewerId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function preloadEventDeckAndTopMedia(eventId: string, viewerId: string): Promise<void> {
  const { data, error } = await supabase.rpc("get_event_deck" as never, {
    p_event_id: eventId,
    p_user_id: viewerId,
    p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT,
  } as never);
  if (error) return;
  const deck = parseEventDeckResponse(data);
  const media = getVideoDateDeckPrefetchItems(deck.profiles, PUSH_DECK_PREFETCH_MEDIA_LIMIT);
  await Promise.allSettled(
    media.map((item) => preloadImage(deckCardUrl(item.source, item.mediaVersion))),
  );
}

function preloadImage(url: string | null | undefined): Promise<void> {
  if (!url || typeof Image === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
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
