/**
 * Canonical web Vibe Video state — same semantics as native `resolveVibeVideoState`.
 * Use everywhere web reads bunny_video_uid / bunny_video_status for UI truth.
 */

import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";
import {
  normalizeBunnyVideoStatus,
  normalizeBunnyVideoUid,
  resolveCanonicalVibeVideoState,
  type BunnyVideoStatusNormalized,
  type CanonicalVibeVideoState,
} from "@clientShared/vibeVideoSemantics";
import { parseMediaCaptions, type MediaCaptions } from "../../../shared/media/captions";

export { normalizeBunnyVideoStatus };
export type { BunnyVideoStatusNormalized };

let webCdnHostnameFallbackReported = false;

/** Normalize hostname: no scheme, no path, lowercase. */
export function normalizeWebStreamCdnHostname(input: string | undefined): string {
  let h = String(input ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  h = h.replace(/^https?:\/\//i, "");
  const slash = h.indexOf("/");
  if (slash >= 0) h = h.slice(0, slash);
  return h.trim().toLowerCase();
}

function trackWebCdnHostnameFallbackUsed(reason: "env_missing" | "normalized_empty"): void {
  if (webCdnHostnameFallbackReported) return;
  webCdnHostnameFallbackReported = true;
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.cdnHostnameFallbackUsed, {
    source: "web_vibe_video_state",
    kind: "cdn_hostname_missing",
    stream_hostname_source: "missing",
    reason,
  });
}

export function getWebVibeVideoStreamHostname(): string {
  const raw = import.meta.env?.VITE_BUNNY_STREAM_CDN_HOSTNAME;
  const hostname = normalizeWebStreamCdnHostname(raw);
  if (!hostname) {
    trackWebCdnHostnameFallbackUsed(raw == null || String(raw).trim() === "" ? "env_missing" : "normalized_empty");
  }
  return hostname;
}

/** Canonical HLS URL; null if uid or hostname missing. */
export function getWebVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  const hostname = getWebVibeVideoStreamHostname();
  const uid = typeof bunnyVideoUid === "string" ? bunnyVideoUid.trim() : "";
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/playlist.m3u8`;
}

export function getWebVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  const hostname = getWebVibeVideoStreamHostname();
  const uid = typeof bunnyVideoUid === "string" ? bunnyVideoUid.trim() : "";
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/thumbnail.jpg`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUNNY_STREAM_VIDEO_ID_PATTERN = /^[0-9a-f-]{32,36}$/i;
const PROFILE_VIBE_VIDEO_REF_PATTERN =
  /^profile_vibe_video:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f-]{32,36})$/i;

export function getWebProfileVibeVideoPlaybackRef(
  profileId: string | null | undefined,
  bunnyVideoUid: string | null | undefined,
): string | null {
  const id = typeof profileId === "string" ? profileId.trim() : "";
  const uid = typeof bunnyVideoUid === "string" ? bunnyVideoUid.trim() : "";
  if (!UUID_PATTERN.test(id) || !BUNNY_STREAM_VIDEO_ID_PATTERN.test(uid)) return null;
  return `profile_vibe_video:${id}:${uid}`;
}

function normalizeProfileVibeVideoPlaybackRef(value: unknown, uid?: string | null): string | null {
  const ref = typeof value === "string" ? value.trim() : "";
  const match = PROFILE_VIBE_VIDEO_REF_PATTERN.exec(ref);
  if (!match) return null;
  if (uid && match[2].toLowerCase() !== uid.toLowerCase()) return null;
  return ref;
}

export type WebVibeVideoState = CanonicalVibeVideoState;

export interface WebVibeVideoInfo {
  state: WebVibeVideoState;
  uid: string | null;
  normalizedStatus: BunnyVideoStatusNormalized;
  statusUpdatedAt: string | null;
  statusAgeMs: number | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  captions: MediaCaptions | null;
  isScoreEligible: boolean;
  canPlay: boolean;
  canManage: boolean;
  canDelete: boolean;
  canRecord: boolean;
}

type ProfileVibeInput = {
  id?: string | null;
  profile_id?: string | null;
  profileId?: string | null;
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  bunny_video_updated_at?: string | number | Date | null;
  updated_at?: string | number | Date | null;
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
  bunnyVideoUpdatedAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
  vibe_caption?: string | null;
  vibeCaption?: string | null;
  vibe_video_playback_ref?: string | null;
  vibeVideoPlaybackRef?: string | null;
  playbackRef?: string | null;
  vibe_video_captions?: unknown;
  vibeVideoCaptions?: unknown;
  captions?: unknown;
} | null | undefined;

function pickProfileId(p: ProfileVibeInput): string | null {
  const raw = p?.id ?? p?.profile_id ?? p?.profileId;
  return typeof raw === "string" ? raw.trim() || null : null;
}

function pickUid(p: ProfileVibeInput): string | null {
  const raw = p?.bunny_video_uid ?? p?.bunnyVideoUid;
  return normalizeBunnyVideoUid(raw);
}

function pickPlaybackRef(p: ProfileVibeInput, uid: string | null): string | null {
  return (
    normalizeProfileVibeVideoPlaybackRef(p?.vibe_video_playback_ref, uid) ??
    normalizeProfileVibeVideoPlaybackRef(p?.vibeVideoPlaybackRef, uid) ??
    normalizeProfileVibeVideoPlaybackRef(p?.playbackRef, uid) ??
    getWebProfileVibeVideoPlaybackRef(pickProfileId(p), uid)
  );
}

function pickStatus(p: ProfileVibeInput): string | null | undefined {
  return p?.bunny_video_status ?? p?.bunnyVideoStatus ?? undefined;
}

function pickUpdatedAt(p: ProfileVibeInput): string | number | Date | null | undefined {
  return p?.bunny_video_updated_at ?? p?.bunnyVideoUpdatedAt ?? p?.updated_at ?? p?.updatedAt ?? undefined;
}

function pickCaption(p: ProfileVibeInput): string | null {
  const c = p?.vibe_caption ?? p?.vibeCaption;
  return typeof c === "string" ? c.trim() || null : null;
}

function pickCaptions(p: ProfileVibeInput): MediaCaptions | null {
  return parseMediaCaptions(p?.vibe_video_captions ?? p?.vibeVideoCaptions ?? p?.captions);
}

export function resolveWebVibeVideoState(profile: ProfileVibeInput): WebVibeVideoInfo {
  const uid = pickUid(profile);
  const canonical = resolveCanonicalVibeVideoState({
    bunnyVideoUid: uid,
    bunnyVideoStatus: pickStatus(profile),
    bunnyVideoUpdatedAt: pickUpdatedAt(profile),
  });
  const normStatus = canonical.status;
  const caption = pickCaption(profile);
  const captions = pickCaptions(profile);

  const NONE: WebVibeVideoInfo = {
    state: "none",
    uid: null,
    normalizedStatus: normStatus,
    statusUpdatedAt: canonical.statusUpdatedAt,
    statusAgeMs: canonical.statusAgeMs,
    playbackUrl: null,
    thumbnailUrl: null,
    caption: null,
    captions: null,
    isScoreEligible: false,
    canPlay: false,
    canManage: false,
    canDelete: false,
    canRecord: true,
  };

  if (!uid) {
    if (canonical.state === "none") return NONE;
    return {
      state: "error",
      uid: null,
      normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt,
      statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      captions,
      isScoreEligible: false,
      canPlay: false,
      canManage: false,
      canDelete: false,
      canRecord: true,
    };
  }

  if (canonical.state === "processing" || canonical.state === "stale_processing") {
    return {
      state: canonical.state,
      uid,
      normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt,
      statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      captions,
      isScoreEligible: true,
      canPlay: false,
      canManage: true,
      canDelete: true,
      canRecord: canonical.state === "stale_processing",
    };
  }

  if (canonical.state === "ready") {
    const playbackRef = pickPlaybackRef(profile, uid);
    const playbackUrl = playbackRef ?? getWebVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = playbackRef ? null : getWebVibeVideoThumbnailUrl(uid);
    return {
      state: "ready",
      uid,
      normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt,
      statusAgeMs: canonical.statusAgeMs,
      playbackUrl,
      thumbnailUrl,
      caption,
      captions,
      isScoreEligible: true,
      canPlay: !!playbackUrl,
      canManage: true,
      canDelete: true,
      canRecord: true,
    };
  }

  if (canonical.state === "failed") {
    return {
      state: "failed",
      uid,
      normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt,
      statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      captions,
      isScoreEligible: true,
      canPlay: false,
      canManage: true,
      canDelete: true,
      canRecord: true,
    };
  }

  return {
    state: "processing",
    uid,
    normalizedStatus: normStatus,
    statusUpdatedAt: canonical.statusUpdatedAt,
    statusAgeMs: canonical.statusAgeMs,
    playbackUrl: null,
    thumbnailUrl: null,
    caption,
    captions,
    isScoreEligible: true,
    canPlay: false,
    canManage: true,
    canDelete: true,
    canRecord: false,
  };
}
