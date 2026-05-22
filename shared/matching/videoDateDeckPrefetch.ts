export const VIDEO_DATE_DECK_PREFETCH_LIMIT = 2;

export type VideoDateDeckPrefetchProfile = {
  id?: string | null;
  primary_photo_path?: string | null;
  photos?: Array<string | null | undefined> | null;
  avatar_url?: string | null;
};

export type VideoDateDeckPrefetchItem = {
  profileId: string | null;
  source: string;
  sourceKind: VideoDateDeckPrefetchTelemetryPayload["source_kind"];
  rank: number;
};

export type VideoDateDeckPrefetchTelemetryPayload = {
  platform: "web" | "native";
  event_id: string | null;
  profile_id_present: boolean;
  rank: number;
  source_kind: "primary_photo_path" | "photo" | "avatar_url";
};

export function getVideoDateDeckPrefetchSource(
  profile: VideoDateDeckPrefetchProfile | null | undefined,
): { source: string; sourceKind: VideoDateDeckPrefetchTelemetryPayload["source_kind"] } | null {
  if (!profile) return null;
  if (typeof profile.primary_photo_path === "string" && profile.primary_photo_path.length > 0) {
    return { source: profile.primary_photo_path, sourceKind: "primary_photo_path" };
  }
  const firstPhoto = Array.isArray(profile.photos)
    ? profile.photos.find((photo): photo is string => typeof photo === "string" && photo.length > 0)
    : null;
  if (firstPhoto) return { source: firstPhoto, sourceKind: "photo" };
  if (typeof profile.avatar_url === "string" && profile.avatar_url.length > 0) {
    return { source: profile.avatar_url, sourceKind: "avatar_url" };
  }
  return null;
}

export function getVideoDateDeckPrefetchItems(
  profiles: readonly VideoDateDeckPrefetchProfile[],
  limit = VIDEO_DATE_DECK_PREFETCH_LIMIT,
): VideoDateDeckPrefetchItem[] {
  const items: VideoDateDeckPrefetchItem[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (items.length >= limit) break;
    const source = getVideoDateDeckPrefetchSource(profile);
    if (!source || seen.has(source.source)) continue;
    seen.add(source.source);
    items.push({
      profileId: typeof profile.id === "string" && profile.id.length > 0 ? profile.id : null,
      source: source.source,
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
