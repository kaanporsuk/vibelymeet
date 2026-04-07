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
};

export type EventDeckProfile = Omit<EventDeckProfileRow, "profile_id"> & {
  id: ProfileId;
};

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
        photos: Array.isArray(source.photos)
          ? source.photos.filter((photo): photo is string => typeof photo === "string")
          : null,
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
      }),
    ];
  });
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
