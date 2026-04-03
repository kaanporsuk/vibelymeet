/**
 * Canonical web Vibe Video state — same semantics as native `resolveVibeVideoState`.
 * Use everywhere web reads bunny_video_uid / bunny_video_status for UI truth.
 */

export type BunnyVideoStatusNormalized = "none" | "uploading" | "processing" | "ready" | "failed" | "unknown";

const ALLOWED: ReadonlySet<string> = new Set(["none", "uploading", "processing", "ready", "failed"]);

export function normalizeBunnyVideoStatus(raw: string | null | undefined): BunnyVideoStatusNormalized {
  const s = String(raw ?? "none")
    .toLowerCase()
    .trim();
  if (!s || s === "null" || s === "undefined") return "none";
  if (s === "1" || s === "2") return "processing";
  if (s === "3" || s === "4") return "ready";
  if (s === "5") return "failed";
  if (ALLOWED.has(s)) return s as BunnyVideoStatusNormalized;
  return "unknown";
}

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

export function getWebVibeVideoStreamHostname(): string {
  return normalizeWebStreamCdnHostname(import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME);
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

export type WebVibeVideoState = "none" | "uploading" | "processing" | "ready" | "failed" | "error";

export interface WebVibeVideoInfo {
  state: WebVibeVideoState;
  uid: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  canPlay: boolean;
  canManage: boolean;
  canDelete: boolean;
  canRecord: boolean;
}

type ProfileVibeInput = {
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
  vibe_caption?: string | null;
  vibeCaption?: string | null;
} | null | undefined;

function pickUid(p: ProfileVibeInput): string | null {
  const raw = p?.bunny_video_uid ?? p?.bunnyVideoUid;
  return typeof raw === "string" ? raw.trim() || null : null;
}

function pickStatus(p: ProfileVibeInput): string | null | undefined {
  return p?.bunny_video_status ?? p?.bunnyVideoStatus ?? undefined;
}

function pickCaption(p: ProfileVibeInput): string | null {
  const c = p?.vibe_caption ?? p?.vibeCaption;
  return typeof c === "string" ? c.trim() || null : null;
}

export function resolveWebVibeVideoState(profile: ProfileVibeInput): WebVibeVideoInfo {
  const uid = pickUid(profile);
  const normStatus = normalizeBunnyVideoStatus(pickStatus(profile));
  const caption = pickCaption(profile);

  const NONE: WebVibeVideoInfo = {
    state: "none",
    uid: null,
    playbackUrl: null,
    thumbnailUrl: null,
    caption: null,
    canPlay: false,
    canManage: false,
    canDelete: false,
    canRecord: true,
  };

  if (!uid) {
    if (normStatus === "none") return NONE;
    return {
      state: "error",
      uid: null,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      canPlay: false,
      canManage: false,
      canDelete: false,
      canRecord: true,
    };
  }

  if (normStatus === "unknown") {
    return {
      state: "processing",
      uid,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      canPlay: false,
      canManage: false,
      canDelete: true,
      canRecord: false,
    };
  }

  if (normStatus === "uploading") {
    return {
      state: "uploading",
      uid,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      canPlay: false,
      canManage: false,
      canDelete: true,
      canRecord: false,
    };
  }

  if (normStatus === "processing") {
    return {
      state: "processing",
      uid,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      canPlay: false,
      canManage: false,
      canDelete: true,
      canRecord: false,
    };
  }

  if (normStatus === "ready") {
    const playbackUrl = getWebVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = getWebVibeVideoThumbnailUrl(uid);
    return {
      state: "ready",
      uid,
      playbackUrl,
      thumbnailUrl,
      caption,
      canPlay: !!playbackUrl,
      canManage: true,
      canDelete: true,
      canRecord: true,
    };
  }

  if (normStatus === "failed") {
    return {
      state: "failed",
      uid,
      playbackUrl: null,
      thumbnailUrl: null,
      caption,
      canPlay: false,
      canManage: false,
      canDelete: true,
      canRecord: true,
    };
  }

  return {
    state: "processing",
    uid,
    playbackUrl: null,
    thumbnailUrl: null,
    caption,
    canPlay: false,
    canManage: false,
    canDelete: true,
    canRecord: false,
  };
}
