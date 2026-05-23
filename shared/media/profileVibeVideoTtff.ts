export const PROFILE_VIBE_VIDEO_TTFF_EVENT = "vibe_video_profile_ttff_ms" as const;

const TTFF_ENTRY_TTL_MS = 2 * 60 * 1000;
const MAX_PROFILE_TTFF_ENTRIES = 200;

const allowedPlatforms = new Set(["web", "native"]);
const allowedSurfaces = new Set([
  "lobby_card",
  "profile_inline",
  "profile_fullscreen",
  "native_lobby_card",
  "native_profile_fullscreen",
]);
const allowedTriggers = new Set([
  "hover",
  "pointer_down",
  "touch_start",
  "focus",
  "click",
  "press_in",
  "press",
  "watch_intro",
  "fullscreen_open",
  "manual_play",
  "autoplay",
]);
const allowedSourceKinds = new Set([
  "profile_vibe_video_ref",
  "hls_url",
  "legacy_url",
  "unknown",
]);

type EntryContext = {
  platform: string;
  surface: string;
  trigger: string;
  reduceMotion: boolean;
  usesSignedProfileRef: boolean;
  sourceKind: string;
};

type PrewarmEntry = EntryContext & {
  atMs: number;
};

type PlaybackEntry = EntryContext & {
  startedAtMs: number;
  prewarm: PrewarmEntry | null;
};

export type ProfileVibeVideoTtffContextInput = {
  profileId?: string | null;
  nowMs?: number;
  platform?: string | null;
  surface?: string | null;
  trigger?: string | null;
  reduceMotion?: boolean | null;
  usesSignedProfileRef?: boolean | null;
  sourceKind?: string | null;
};

export type ProfileVibeVideoTtffEventPayload = {
  platform: string;
  surface: string;
  trigger: string;
  ttff_ms: number;
  ttff_bucket: string;
  warm_intent: boolean;
  prewarm_age_ms: number | null;
  prewarm_trigger: string | null;
  prewarm_surface: string | null;
  reduce_motion: boolean;
  signed_profile_ref: boolean;
  source_kind: string;
  outcome: "first_frame";
};

const prewarmByProfileId = new Map<string, PrewarmEntry>();
const playbackByToken = new Map<string, PlaybackEntry>();
let tokenSequence = 0;

function nowFrom(input: ProfileVibeVideoTtffContextInput): number {
  const value = input.nowMs;
  return Number.isFinite(value) ? Math.max(0, Number(value)) : Date.now();
}

function profileKey(profileId: string | null | undefined): string | null {
  const value = typeof profileId === "string" ? profileId.trim() : "";
  return value.length > 0 && value.length <= 160 ? value : null;
}

function allowedLabel(
  value: string | null | undefined,
  allowed: Set<string>,
  fallback: string,
): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.has(normalized) ? normalized : fallback;
}

function contextFrom(input: ProfileVibeVideoTtffContextInput): EntryContext {
  return {
    platform: allowedLabel(input.platform, allowedPlatforms, "web"),
    surface: allowedLabel(input.surface, allowedSurfaces, "profile_inline"),
    trigger: allowedLabel(input.trigger, allowedTriggers, "autoplay"),
    reduceMotion: input.reduceMotion === true,
    usesSignedProfileRef: input.usesSignedProfileRef === true,
    sourceKind: allowedLabel(input.sourceKind, allowedSourceKinds, "unknown"),
  };
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(TTFF_ENTRY_TTL_MS, value)));
}

function pruneExpired(nowMs: number): void {
  for (const [key, entry] of prewarmByProfileId) {
    if (nowMs - entry.atMs > TTFF_ENTRY_TTL_MS) prewarmByProfileId.delete(key);
  }
  for (const [token, entry] of playbackByToken) {
    if (nowMs - entry.startedAtMs > TTFF_ENTRY_TTL_MS) playbackByToken.delete(token);
  }
}

function enforceSizeLimit<T>(map: Map<string, T>): void {
  while (map.size > MAX_PROFILE_TTFF_ENTRIES) {
    const first = map.keys().next();
    if (first.done) return;
    map.delete(first.value);
  }
}

function freshPrewarm(profileId: string, nowMs: number): PrewarmEntry | null {
  const prewarm = prewarmByProfileId.get(profileId) ?? null;
  if (!prewarm) return null;
  if (nowMs - prewarm.atMs > TTFF_ENTRY_TTL_MS) {
    prewarmByProfileId.delete(profileId);
    return null;
  }
  return prewarm;
}

function strongerPrewarmTrigger(existing: string, next: string): string {
  if (existing === "hover" && next !== "hover") return next;
  return existing;
}

function strongerSourceKind(existing: string, next: string): string {
  if (next === "profile_vibe_video_ref") return next;
  if (existing === "unknown" && next !== "unknown") return next;
  return existing;
}

function mergePrewarmEntry(
  existing: PrewarmEntry | null,
  next: PrewarmEntry,
): PrewarmEntry {
  if (!existing) return next;
  return {
    ...existing,
    platform: next.platform,
    surface: existing.surface,
    trigger: strongerPrewarmTrigger(existing.trigger, next.trigger),
    reduceMotion: existing.reduceMotion || next.reduceMotion,
    usesSignedProfileRef: existing.usesSignedProfileRef || next.usesSignedProfileRef,
    sourceKind: strongerSourceKind(existing.sourceKind, next.sourceKind),
  };
}

export function profileVibeVideoTtffBucket(ttffMs: number): string {
  if (ttffMs <= 250) return "0_250";
  if (ttffMs <= 500) return "251_500";
  if (ttffMs <= 700) return "501_700";
  if (ttffMs <= 1200) return "701_1200";
  if (ttffMs <= 1500) return "1201_1500";
  if (ttffMs <= 2500) return "1501_2500";
  return "2501_plus";
}

export function markProfileVibeVideoTtffPrewarm(
  input: ProfileVibeVideoTtffContextInput,
): void {
  const profileId = profileKey(input.profileId);
  if (!profileId) return;
  const nowMs = nowFrom(input);
  pruneExpired(nowMs);
  const next = {
    ...contextFrom(input),
    atMs: nowMs,
  };
  prewarmByProfileId.set(profileId, mergePrewarmEntry(freshPrewarm(profileId, nowMs), next));
  enforceSizeLimit(prewarmByProfileId);
}

export function beginProfileVibeVideoTtffPlayback(
  input: ProfileVibeVideoTtffContextInput,
): string | null {
  const profileId = profileKey(input.profileId);
  if (!profileId) return null;
  const nowMs = nowFrom(input);
  pruneExpired(nowMs);
  const token = `profile-vibe-video-ttff:${++tokenSequence}`;
  playbackByToken.set(token, {
    ...contextFrom(input),
    startedAtMs: nowMs,
    prewarm: freshPrewarm(profileId, nowMs),
  });
  enforceSizeLimit(playbackByToken);
  return token;
}

export function completeProfileVibeVideoTtffPlayback(input: {
  token?: string | null;
  nowMs?: number;
}): ProfileVibeVideoTtffEventPayload | null {
  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return null;
  const nowMs = Number.isFinite(input.nowMs) ? Math.max(0, Number(input.nowMs)) : Date.now();
  pruneExpired(nowMs);
  const entry = playbackByToken.get(token);
  if (!entry) return null;
  playbackByToken.delete(token);

  const ttffMs = clampDuration(nowMs - entry.startedAtMs);
  const prewarmAgeMs = entry.prewarm ? clampDuration(entry.startedAtMs - entry.prewarm.atMs) : null;
  return {
    platform: entry.platform,
    surface: entry.surface,
    trigger: entry.trigger,
    ttff_ms: ttffMs,
    ttff_bucket: profileVibeVideoTtffBucket(ttffMs),
    warm_intent: entry.prewarm !== null,
    prewarm_age_ms: prewarmAgeMs,
    prewarm_trigger: entry.prewarm?.trigger ?? null,
    prewarm_surface: entry.prewarm?.surface ?? null,
    reduce_motion: entry.reduceMotion,
    signed_profile_ref: entry.usesSignedProfileRef,
    source_kind: entry.sourceKind,
    outcome: "first_frame",
  };
}

export function __resetProfileVibeVideoTtffForTest(): void {
  prewarmByProfileId.clear();
  playbackByToken.clear();
  tokenSequence = 0;
}
