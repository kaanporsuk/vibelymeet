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
  isScoreEligible: boolean;
  canPlay: boolean;
  canManage: boolean;
  canDelete: boolean;
  canRecord: boolean;
}

type ProfileVibeInput = {
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
} | null | undefined;

function pickUid(p: ProfileVibeInput): string | null {
  const raw = p?.bunny_video_uid ?? p?.bunnyVideoUid;
  return normalizeBunnyVideoUid(raw);
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

export function resolveWebVibeVideoState(profile: ProfileVibeInput): WebVibeVideoInfo {
  const uid = pickUid(profile);
  const canonical = resolveCanonicalVibeVideoState({
    bunnyVideoUid: uid,
    bunnyVideoStatus: pickStatus(profile),
    bunnyVideoUpdatedAt: pickUpdatedAt(profile),
  });
  const normStatus = canonical.status;
  const caption = pickCaption(profile);

  const NONE: WebVibeVideoInfo = {
    state: "none",
    uid: null,
    normalizedStatus: normStatus,
    statusUpdatedAt: canonical.statusUpdatedAt,
    statusAgeMs: canonical.statusAgeMs,
    playbackUrl: null,
    thumbnailUrl: null,
    caption: null,
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
      isScoreEligible: true,
      canPlay: false,
      canManage: false,
      canDelete: true,
      canRecord: canonical.state === "stale_processing",
    };
  }

  if (canonical.state === "ready") {
    const playbackUrl = getWebVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = getWebVibeVideoThumbnailUrl(uid);
    return {
      state: "ready",
      uid,
      normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt,
      statusAgeMs: canonical.statusAgeMs,
      playbackUrl,
      thumbnailUrl,
      caption,
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
      isScoreEligible: true,
      canPlay: false,
      canManage: false,
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
    isScoreEligible: true,
    canPlay: false,
    canManage: false,
    canDelete: true,
    canRecord: false,
  };
}
