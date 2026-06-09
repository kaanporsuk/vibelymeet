export const VIDEO_DATE_DECK_PREFETCH_LIMIT = 3;
export const VIDEO_DATE_DECK_RECENT_SWIPE_LIMIT = 30;
export const VIDEO_DATE_DECK_RECENT_SWIPE_TTL_MS = 90_000;
export const VIDEO_DATE_DECK_DEFAULT_REFETCH_INTERVAL_MS = 15_000;
export const VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS = 5_000;
export const VIDEO_DATE_DECK_FINAL_REFETCH_INTERVAL_MS = 2_000;
export const VIDEO_DATE_DECK_LAST_CHANCE_REFETCH_INTERVAL_MS = 1_000;
export const VIDEO_DATE_DECK_DEFAULT_RATE_LIMIT_RETRY_MS = 5_000;

export type VideoDateDeckPrefetchProfile = {
  id?: string | null;
  primary_photo_path?: string | null;
  photos?: Array<string | null | undefined> | null;
  avatar_url?: string | null;
  media_version?: string | number | null;
};

export type VideoDateDeckPrefetchItem = {
  profileId: string | null;
  source: string;
  mediaVersion: string | null;
  cacheKey: string;
  sourceKind: VideoDateDeckPrefetchTelemetryPayload["source_kind"];
  rank: number;
};

export type VideoDateDeckRecentSwipeEntry = {
  profileId: string;
  swipedAtMs: number;
};

export type VideoDateDeckPrefetchTelemetryPayload = {
  platform: "web" | "native";
  event_id: string | null;
  profile_id_present: boolean;
  rank: number;
  source_kind: "primary_photo_path" | "photo" | "avatar_url";
};

export type VideoDateSwipeRateLimitLike = {
  result?: string | null;
  outcome?: string | null;
  error?: string | null;
  reason?: string | null;
  retry_after_seconds?: number | string | null;
  retryAfterSeconds?: number | string | null;
  retry_after_ms?: number | string | null;
  retryAfterMs?: number | string | null;
  retry_after?: number | string | null;
  retryAfter?: number | string | null;
  retry_at?: string | number | null;
  retryAt?: string | number | null;
};

export type VideoDateSwipeOutcomeLike = VideoDateSwipeRateLimitLike | string | null | undefined;

const VIDEO_DATE_DECK_NO_RESTORE_SWIPE_OUTCOMES = new Set([
  "already_swiped",
  "blocked",
  "pair_already_met_this_event",
  "permanent_failure",
  "reported",
  "swipe_already_recorded",
  "target_not_found",
  "target_unavailable",
]);

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function cleanMediaVersion(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return cleanString(value);
}

function finitePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function getVideoDateDeckPrefetchSource(
  profile: VideoDateDeckPrefetchProfile | null | undefined,
): { source: string; sourceKind: VideoDateDeckPrefetchTelemetryPayload["source_kind"] } | null {
  if (!profile) return null;
  const primaryPhotoPath = cleanString(profile.primary_photo_path);
  if (primaryPhotoPath) {
    return { source: primaryPhotoPath, sourceKind: "primary_photo_path" };
  }
  const firstPhoto = Array.isArray(profile.photos)
    ? profile.photos.map(cleanString).find((photo): photo is string => Boolean(photo))
    : null;
  if (firstPhoto) return { source: firstPhoto, sourceKind: "photo" };
  const avatarUrl = cleanString(profile.avatar_url);
  if (avatarUrl) {
    return { source: avatarUrl, sourceKind: "avatar_url" };
  }
  return null;
}

export function getVideoDateDeckPrefetchCacheKey(
  profile: VideoDateDeckPrefetchProfile | null | undefined,
  source: string,
): string {
  const profileId = cleanString(profile?.id) ?? "unknown-profile";
  const mediaVersion = cleanMediaVersion(profile?.media_version) ?? "unversioned";
  return `${profileId}:${mediaVersion}:${source}`;
}

export function appendVideoDateDeckMediaVersion(
  url: string | null | undefined,
  mediaVersion: string | number | null | undefined,
): string | null {
  if (!url) return null;
  const version = cleanMediaVersion(mediaVersion);
  if (!version || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

export function getVideoDateDeckPrefetchItems(
  profiles: readonly VideoDateDeckPrefetchProfile[],
  limit = VIDEO_DATE_DECK_PREFETCH_LIMIT,
): VideoDateDeckPrefetchItem[] {
  const items: VideoDateDeckPrefetchItem[] = [];
  const seen = new Set<string>();
  const itemLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : VIDEO_DATE_DECK_PREFETCH_LIMIT;
  for (const profile of profiles) {
    if (items.length >= itemLimit) break;
    const source = getVideoDateDeckPrefetchSource(profile);
    if (!source) continue;
    const mediaVersion = cleanMediaVersion(profile.media_version);
    const sourceCacheKey = `${mediaVersion ?? "unversioned"}:${source.source}`;
    if (seen.has(sourceCacheKey)) continue;
    seen.add(sourceCacheKey);
    const cacheKey = getVideoDateDeckPrefetchCacheKey(profile, source.source);
    const profileId = cleanString(profile.id);
    items.push({
      profileId,
      source: source.source,
      mediaVersion,
      cacheKey,
      sourceKind: source.sourceKind,
      rank: items.length,
    });
  }
  return items;
}

export function buildVideoDateDeckPrefetchTelemetryPayload(input: {
  platform: "web" | "native";
  eventId?: string | null;
  profileId?: string | null;
  rank: number;
  sourceKind: VideoDateDeckPrefetchTelemetryPayload["source_kind"];
}): VideoDateDeckPrefetchTelemetryPayload {
  return {
    platform: input.platform,
    event_id: input.eventId ?? null,
    profile_id_present: Boolean(input.profileId),
    rank: Math.max(0, Math.floor(input.rank)),
    source_kind: input.sourceKind,
  };
}

export function pruneVideoDateDeckRecentSwipes(
  entries: readonly VideoDateDeckRecentSwipeEntry[],
  nowMs = Date.now(),
): VideoDateDeckRecentSwipeEntry[] {
  return entries
    .filter((entry) => {
      const ageMs = nowMs - entry.swipedAtMs;
      return entry.profileId && ageMs >= 0 && ageMs < VIDEO_DATE_DECK_RECENT_SWIPE_TTL_MS;
    })
    .sort((a, b) => b.swipedAtMs - a.swipedAtMs)
    .slice(0, VIDEO_DATE_DECK_RECENT_SWIPE_LIMIT);
}

export function recordVideoDateDeckRecentSwipe(
  entries: readonly VideoDateDeckRecentSwipeEntry[],
  profileId: string | null | undefined,
  nowMs = Date.now(),
): VideoDateDeckRecentSwipeEntry[] {
  const cleanProfileId = cleanString(profileId);
  if (!cleanProfileId) return pruneVideoDateDeckRecentSwipes(entries, nowMs);
  const next = [
    { profileId: cleanProfileId, swipedAtMs: nowMs },
    ...entries.filter((entry) => entry.profileId !== cleanProfileId),
  ];
  return pruneVideoDateDeckRecentSwipes(next, nowMs);
}

export function removeVideoDateDeckRecentSwipe(
  entries: readonly VideoDateDeckRecentSwipeEntry[],
  profileId: string | null | undefined,
  nowMs = Date.now(),
): VideoDateDeckRecentSwipeEntry[] {
  const cleanProfileId = cleanString(profileId);
  if (!cleanProfileId) return pruneVideoDateDeckRecentSwipes(entries, nowMs);
  return pruneVideoDateDeckRecentSwipes(
    entries.filter((entry) => entry.profileId !== cleanProfileId),
    nowMs,
  );
}

export function shouldSuppressVideoDateDeckProfile(
  profile: { id?: string | null } | null | undefined,
  entries: readonly VideoDateDeckRecentSwipeEntry[],
  nowMs = Date.now(),
): boolean {
  const profileId = cleanString(profile?.id);
  if (!profileId) return false;
  return entries.some(
    (entry) =>
      entry.profileId === profileId &&
      nowMs - entry.swipedAtMs >= 0 &&
      nowMs - entry.swipedAtMs < VIDEO_DATE_DECK_RECENT_SWIPE_TTL_MS,
  );
}

export function getVideoDateDeckAdaptiveRefetchIntervalMs(input: {
  enabled: boolean;
  eventEndAtMs?: number | null;
  nowMs?: number;
  visibleCount?: number | null;
  hidden?: boolean;
}): number | false {
  if (!input.enabled || input.hidden) return false;
  const eventEndAtMs = typeof input.eventEndAtMs === "number" && Number.isFinite(input.eventEndAtMs)
    ? input.eventEndAtMs
    : null;
  const nowMs = typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  if (eventEndAtMs != null && eventEndAtMs <= nowMs) return false;

  const remainingMs = eventEndAtMs == null ? Number.POSITIVE_INFINITY : eventEndAtMs - nowMs;
  if (remainingMs <= 30_000) return VIDEO_DATE_DECK_LAST_CHANCE_REFETCH_INTERVAL_MS;
  if (remainingMs <= 120_000) return VIDEO_DATE_DECK_FINAL_REFETCH_INTERVAL_MS;
  if (remainingMs <= 300_000) return VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS;

  const visibleCount = finiteNonNegativeInteger(input.visibleCount);
  if (visibleCount <= 1) return VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS;

  return VIDEO_DATE_DECK_DEFAULT_REFETCH_INTERVAL_MS;
}

export function isVideoDateSwipeRateLimited(result: VideoDateSwipeRateLimitLike | null | undefined): boolean {
  const code = videoDateSwipeOutcomeCode(result);
  return code === "rate_limited" || code === "too_many_requests" || code === "swipe_rate_limited";
}

export function shouldRestoreVideoDateDeckCardAfterSwipeFailure(
  result: VideoDateSwipeOutcomeLike,
): boolean {
  const code = videoDateSwipeOutcomeCode(result);
  return code == null || !VIDEO_DATE_DECK_NO_RESTORE_SWIPE_OUTCOMES.has(code);
}

function videoDateSwipeOutcomeCode(result: VideoDateSwipeOutcomeLike): string | null {
  const rawCode = typeof result === "string"
    ? result
    : result?.outcome ?? result?.result ?? result?.error ?? result?.reason;
  if (typeof rawCode !== "string") return null;
  const code = rawCode.trim().toLowerCase();
  return code === "swipe_recorded" ? "vibe_recorded" : code || null;
}

export function getVideoDateSwipeRateLimitRetryUntilMs(
  result: VideoDateSwipeRateLimitLike | null | undefined,
  nowMs = Date.now(),
  retryAfterHeader?: string | null,
): number | null {
  if (!result && !retryAfterHeader) return null;

  const explicitAt = result?.retry_at ?? result?.retryAt;
  if (typeof explicitAt === "string" && explicitAt.trim()) {
    const parsed = Date.parse(explicitAt);
    if (Number.isFinite(parsed) && parsed > nowMs) return parsed;
  } else if (typeof explicitAt === "number" && Number.isFinite(explicitAt) && explicitAt > nowMs) {
    return explicitAt;
  }

  const explicitMs = finitePositiveNumber(result?.retry_after_ms ?? result?.retryAfterMs);
  if (explicitMs != null) return nowMs + explicitMs;

  const explicitSeconds = finitePositiveNumber(
    result?.retry_after_seconds ?? result?.retryAfterSeconds ?? result?.retry_after ?? result?.retryAfter,
  );
  if (explicitSeconds != null) return nowMs + explicitSeconds * 1000;

  const explicitRetryAfter = result?.retry_after ?? result?.retryAfter;
  if (typeof explicitRetryAfter === "string" && explicitRetryAfter.trim()) {
    const parsed = Date.parse(explicitRetryAfter);
    if (Number.isFinite(parsed) && parsed > nowMs) return parsed;
  }

  const headerSeconds = finitePositiveNumber(retryAfterHeader);
  if (headerSeconds != null) return nowMs + headerSeconds * 1000;

  if (retryAfterHeader && retryAfterHeader.trim()) {
    const parsed = Date.parse(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > nowMs) return parsed;
  }

  return isVideoDateSwipeRateLimited(result) ? nowMs + VIDEO_DATE_DECK_DEFAULT_RATE_LIMIT_RETRY_MS : null;
}
