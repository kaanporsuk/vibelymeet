import {
  normalizeProfilePhotoDerivatives,
  type ProfilePhotoDerivativeMap,
} from "../../shared/profile/photoDerivatives";

const BUNNY_CDN = (() => {
  const raw = import.meta.env.VITE_BUNNY_CDN_HOSTNAME ?? "";
  const host = raw.replace(/^["']|["']$/g, "").trim();
  return host ? `https://${host}` : "";
})();
const BUNNY_CDN_PATH_PREFIX = (() => {
  const raw = import.meta.env.VITE_BUNNY_CDN_PATH_PREFIX ?? "";
  return raw.trim().replace(/^\/+|\/+$/g, "");
})();
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const CONFIRMED_BUNNY_STORAGE_PREFIXES = ["photos/", "events/", "voice/", "media/"];
type ImageDerivativePathSet = { thumb?: string; display?: string; hero?: string };
const imageDerivativePathsByOriginalPath = new Map<string, ImageDerivativePathSet>();

const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231F1F2E'/%3E%3Ccircle cx='100' cy='80' r='35' fill='%234B4B6B'/%3E%3Cellipse cx='100' cy='160' rx='55' ry='40' fill='%234B4B6B'/%3E%3C/svg%3E";

interface ImageUrlOptions {
  /** Intended display size. Confirmed upload-time derivatives may use this to pick a right-sized object. */
  width?: number;
  height?: number;
  quality?: number;
  crop?: "center" | "top" | "bottom" | "left" | "right";
}

function normalizeImagePath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  let out = path.trim();
  if (!out) return null;

  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }
  if (!out) return null;

  // Protocol-relative URLs should be treated as already resolved URLs.
  if (out.startsWith("//")) return `https:${out}`;

  // Tolerate leading slash variants like "/photos/..." or "/bucket/path.jpg".
  if (out.startsWith("/")) {
    out = out.replace(/^\/+/, "");
  }

  return out || null;
}

function stripBunnyStorageDecorations(value: string): string {
  // Stale Optimizer/cache params are not part of Bunny Storage object paths.
  return value.split(/[?#]/, 1)[0] || value;
}

export function rememberImageDerivatives(
  originalPath: string | null | undefined,
  derivatives: { thumb?: string | null; display?: string | null; hero?: string | null } | null | undefined,
): void {
  const normalized = normalizeImagePath(originalPath);
  if (!normalized || !derivatives) return;
  const clean = stripBunnyStorageDecorations(normalized);
  const thumb = normalizeImagePath(derivatives.thumb)?.trim();
  const display = normalizeImagePath(derivatives.display)?.trim();
  const hero = normalizeImagePath(derivatives.hero)?.trim();
  if (!thumb && !display && !hero) return;
  imageDerivativePathsByOriginalPath.set(clean, {
    ...(thumb ? { thumb: stripBunnyStorageDecorations(thumb) } : {}),
    ...(display ? { display: stripBunnyStorageDecorations(display) } : {}),
    ...(hero ? { hero: stripBunnyStorageDecorations(hero) } : {}),
  });
}

export function rememberProfilePhotoDerivativeMap(raw: unknown): ProfilePhotoDerivativeMap {
  const derivativesByPath = normalizeProfilePhotoDerivatives(raw);
  for (const [originalPath, derivatives] of Object.entries(derivativesByPath)) {
    rememberImageDerivatives(originalPath, derivatives);
  }
  return derivativesByPath;
}

function derivativeStoragePathForDisplay(storagePath: string, opts?: ImageUrlOptions): string {
  const clean = stripBunnyStorageDecorations(storagePath);
  const requestedEdge = Math.max(
    typeof opts?.width === "number" && Number.isFinite(opts.width) ? opts.width : 0,
    typeof opts?.height === "number" && Number.isFinite(opts.height) ? opts.height : 0,
  );
  const knownDerivatives = imageDerivativePathsByOriginalPath.get(clean);
  if (!knownDerivatives || requestedEdge <= 0) return clean;
  if (requestedEdge <= 420) {
    return knownDerivatives.thumb ?? knownDerivatives.display ?? knownDerivatives.hero ?? clean;
  }
  if (requestedEdge <= 720) {
    return knownDerivatives.display ?? knownDerivatives.hero ?? knownDerivatives.thumb ?? clean;
  }
  if (requestedEdge <= 1400) {
    return knownDerivatives.hero ?? knownDerivatives.display ?? knownDerivatives.thumb ?? clean;
  }
  return clean;
}

export function getImageUrl(
  path: string | null | undefined,
  opts?: ImageUrlOptions
): string {
  const p = normalizeImagePath(path);
  if (!p) return PLACEHOLDER;

  // Already a full Supabase URL (signed or public) — serve directly
  if (p.includes("supabase.co") || p.includes("supabase.in")) {
    return p;
  }

  // Already a full URL pointing somewhere else (blob:, data:, cdn, etc)
  if (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  ) {
    if (BUNNY_CDN && p.startsWith(`${BUNNY_CDN}/`)) {
      return stripBunnyStorageDecorations(p);
    }
    return p;
  }

  // Confirmed Bunny Storage paths. Chat video remains resolved by get-chat-media-url
  // until that source of truth is fully verified.
  if (CONFIRMED_BUNNY_STORAGE_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    if (!BUNNY_CDN) return PLACEHOLDER;
    const storagePath = derivativeStoragePathForDisplay(p, opts);
    const pathPart = BUNNY_CDN_PATH_PREFIX ? `${BUNNY_CDN_PATH_PREFIX}/${storagePath}` : storagePath;
    return `${BUNNY_CDN}/${pathPart}`;
  }

  // Legacy Supabase storage path (relative path, no domain)
  return `${SUPABASE_URL}/storage/v1/object/public/${p}`;
}

// Convenience presets
export const avatarUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 200, height: 200, crop: "center" });

export const swipeCardUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 720, crop: "center" });

export const deckCardUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 1080, height: 1440, crop: "center", quality: 88 });

export const thumbnailUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 400, height: 400, crop: "center" });

export const fullScreenUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 1200 });

// Event cover presets
export const eventCoverHeroUrl = (path: string | null | undefined): string =>
  getImageUrl(path, { width: 1200, quality: 85 });

export const eventCoverCardUrl = (path: string | null | undefined): string =>
  getImageUrl(path, { width: 600, height: 338, quality: 85 });

export const eventCoverThumbUrl = (path: string | null | undefined): string =>
  getImageUrl(path, { width: 300, quality: 80 });
