import { asProfileId, type ProfileId } from "./identity";

export type EventDeckProfileRow = {
  profile_id: string;
  name: string;
  age: number | null;
  gender: string;
  avatar_url: string | null;
  photos: string[] | null;
  about_me: string | null;
  job: string | null;
  location: string | null;
  height_cm: number | null;
  tagline: string | null;
  looking_for: string | null;
  queue_status: string | null;
  has_met_before: boolean;
  is_already_connected: boolean;
  has_super_vibed: boolean;
  shared_vibe_count: number;
  primary_photo_path: string | null;
  photo_verified: boolean | null;
  premium_badge: string | null;
  availability_state: "available" | string | null;
};

export type EventDeckProfile = Omit<
  EventDeckProfileRow,
  "profile_id" | "photo_verified" | "premium_badge" | "availability_state"
> & {
  id: ProfileId;
  photo_verified: boolean;
  premium_badge: "premium" | "vip" | null;
  availability_state: string;
};

export const EVENT_DECK_STATE_REASONS = [
  "has_profiles",
  "ready",
  "event_not_active",
  "not_registered",
  "no_confirmed_candidates",
  "no_remaining_profiles",
  "scan_window_exhausted",
  "viewer_paused",
  "unknown",
] as const;

export type EventDeckStateReason = (typeof EVENT_DECK_STATE_REASONS)[number];

export type EventDeckState = {
  reason: EventDeckStateReason;
  retryable: boolean;
  inactive_reason: string | null;
  limit: number | null;
  scan_limit: number | null;
  raw_count: number | null;
  profile_count: number | null;
  marked_count: number | null;
};

export type EventDeckFetchResult = {
  ok: boolean;
  profiles: EventDeckProfile[];
  deckState: EventDeckState;
};

function sanitizeDeckString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = value.trim();
  if (!out) return null;

  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }

  return out.length > 0 ? out : null;
}

function sanitizePhotoList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const photos = value.flatMap((photo) => {
    const sanitized = sanitizeDeckString(photo);
    return sanitized ? [sanitized] : [];
  });
  return photos.length > 0 ? photos : null;
}

function resolvePrimaryDeckPhotoPath(row: {
  primary_photo_path?: unknown;
  photos?: unknown;
  avatar_url?: unknown;
}): string | null {
  const primary = sanitizeDeckString(row.primary_photo_path);
  if (primary) return primary;

  const photos = sanitizePhotoList(row.photos);
  if (photos?.[0]) return photos[0];

  return sanitizeDeckString(row.avatar_url);
}

function toPremiumBadge(value: unknown): "premium" | "vip" | null {
  return value === "premium" || value === "vip" ? value : null;
}

export function toEventDeckProfile(row: EventDeckProfileRow): EventDeckProfile {
  return {
    id: asProfileId(row.profile_id),
    name: row.name,
    age: row.age,
    gender: row.gender,
    avatar_url: row.avatar_url ?? null,
    photos: Array.isArray(row.photos) ? row.photos.filter((photo): photo is string => typeof photo === "string") : null,
    about_me: row.about_me ?? null,
    job: row.job ?? null,
    location: row.location ?? null,
    height_cm: typeof row.height_cm === "number" ? row.height_cm : null,
    tagline: row.tagline ?? null,
    looking_for: row.looking_for ?? null,
    queue_status: row.queue_status ?? null,
    has_met_before: row.has_met_before === true,
    is_already_connected: row.is_already_connected === true,
    has_super_vibed: row.has_super_vibed === true,
    shared_vibe_count: typeof row.shared_vibe_count === "number" ? row.shared_vibe_count : 0,
    primary_photo_path: resolvePrimaryDeckPhotoPath(row),
    photo_verified: row.photo_verified === true,
    premium_badge: toPremiumBadge(row.premium_badge),
    availability_state: sanitizeDeckString(row.availability_state) ?? "available",
  };
}

export function parseEventDeckProfiles(data: unknown): EventDeckProfile[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const source = row as Record<string, unknown>;
    if (typeof source.profile_id !== "string" || source.profile_id.length === 0) return [];

    return [
      toEventDeckProfile({
        profile_id: source.profile_id,
        name: typeof source.name === "string" ? source.name : "",
        age: typeof source.age === "number" ? source.age : null,
        gender: typeof source.gender === "string" ? source.gender : "",
        avatar_url: typeof source.avatar_url === "string" ? source.avatar_url : null,
        photos: sanitizePhotoList(source.photos),
        about_me: typeof source.about_me === "string" ? source.about_me : null,
        job: typeof source.job === "string" ? source.job : null,
        location: typeof source.location === "string" ? source.location : null,
        height_cm: typeof source.height_cm === "number" ? source.height_cm : null,
        tagline: typeof source.tagline === "string" ? source.tagline : null,
        looking_for: typeof source.looking_for === "string" ? source.looking_for : null,
        queue_status: typeof source.queue_status === "string" ? source.queue_status : null,
        has_met_before: source.has_met_before === true,
        is_already_connected: source.is_already_connected === true,
        has_super_vibed: source.has_super_vibed === true,
        shared_vibe_count: typeof source.shared_vibe_count === "number" ? source.shared_vibe_count : 0,
        primary_photo_path: resolvePrimaryDeckPhotoPath(source),
        photo_verified: source.photo_verified === true,
        premium_badge: toPremiumBadge(source.premium_badge),
        availability_state: sanitizeDeckString(source.availability_state) ?? "available",
      }),
    ];
  });
}

function normalizeDeckStateReason(value: unknown): EventDeckStateReason {
  if (typeof value !== "string") return "unknown";
  if (value === "ready") return "has_profiles";
  if (value === "no_confirmed_candidates" || value === "scan_window_exhausted") {
    return "no_remaining_profiles";
  }
  return (EVENT_DECK_STATE_REASONS as readonly string[]).includes(value)
    ? value as EventDeckStateReason
    : "unknown";
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeEventDeckState(raw: unknown, fallbackProfileCount: number): EventDeckState {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const reason = normalizeDeckStateReason(source.reason ?? (fallbackProfileCount > 0 ? "has_profiles" : "unknown"));
  return {
    reason,
    retryable: source.retryable === true,
    inactive_reason: typeof source.inactive_reason === "string" ? source.inactive_reason : null,
    limit: finiteNumberOrNull(source.limit),
    scan_limit: finiteNumberOrNull(source.scan_limit) ?? finiteNumberOrNull(source.scanLimit),
    raw_count: finiteNumberOrNull(source.raw_count),
    profile_count: finiteNumberOrNull(source.profile_count) ?? fallbackProfileCount,
    marked_count: finiteNumberOrNull(source.marked_count),
  };
}

export function parseEventDeckResponse(data: unknown): EventDeckFetchResult {
  if (Array.isArray(data)) {
    const profiles = parseEventDeckProfiles(data);
    return {
      ok: true,
      profiles,
      deckState: normalizeEventDeckState(
        { reason: profiles.length > 0 ? "has_profiles" : "unknown", profile_count: profiles.length },
        profiles.length,
      ),
    };
  }

  if (!data || typeof data !== "object") {
    return {
      ok: false,
      profiles: [],
      deckState: normalizeEventDeckState({ reason: "unknown", retryable: true, profile_count: 0 }, 0),
    };
  }

  const source = data as Record<string, unknown>;
  const profiles = parseEventDeckProfiles(source.profiles);
  return {
    ok: source.ok === true,
    profiles,
    deckState: normalizeEventDeckState(source.deck_state ?? source.deckState, profiles.length),
  };
}

export type EventAttendeePreviewRow = {
  profile_id: string;
  name: string;
  age: number;
  avatar_path: string | null;
  shared_vibe_count: number;
  super_vibe_toward_viewer: boolean;
  vibe_label: string | null;
};

export type EventAttendeePreview = Omit<EventAttendeePreviewRow, "profile_id"> & {
  id: ProfileId;
};

export function toEventAttendeePreview(row: EventAttendeePreviewRow): EventAttendeePreview {
  return {
    id: asProfileId(row.profile_id),
    name: row.name,
    age: row.age,
    avatar_path: row.avatar_path ?? null,
    shared_vibe_count: typeof row.shared_vibe_count === "number" ? row.shared_vibe_count : 0,
    super_vibe_toward_viewer: row.super_vibe_toward_viewer === true,
    vibe_label: row.vibe_label ?? null,
  };
}

export function parseEventAttendeePreviewRows(raw: unknown): EventAttendeePreview[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const source = row as Record<string, unknown>;
    if (typeof source.profile_id !== "string" || source.profile_id.length === 0) return [];

    return [
      toEventAttendeePreview({
        profile_id: source.profile_id,
        name: typeof source.name === "string" ? source.name : "",
        age: typeof source.age === "number" ? source.age : 0,
        avatar_path: source.avatar_path == null ? null : String(source.avatar_path),
        shared_vibe_count: typeof source.shared_vibe_count === "number" ? source.shared_vibe_count : 0,
        super_vibe_toward_viewer: source.super_vibe_toward_viewer === true,
        vibe_label: source.vibe_label == null ? null : String(source.vibe_label),
      }),
    ];
  });
}
