import {
  normalizeProfilePhotoDerivatives,
  type ProfilePhotoDerivativeMap,
} from '../../../shared/profile/photoDerivatives';
import { isPrivateChatScopedStoragePath } from '../../../shared/media/privateMediaPaths';

/**
 * Resolve profile/event image paths to full URLs.
 * Same logic as web src/utils/imageUrl.ts — Bunny CDN for confirmed Storage prefixes,
 * Supabase storage for legacy paths.
 *
 * Required for native: set EXPO_PUBLIC_BUNNY_CDN_HOSTNAME in .env (same value as web VITE_BUNNY_CDN_HOSTNAME).
 * Env is inlined at Metro bundle time; restart Metro after changing .env.
 * If unset, photos/ paths return a placeholder so we never build wrong Supabase URLs (Bunny assets
 * are not in Supabase storage).
 */
const BUNNY_CDN = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_CDN_HOSTNAME ?? '';
  const host = raw.replace(/^["']|["']$/g, '').trim();
  return host ? `https://${host}` : '';
})();
const BUNNY_CDN_PATH_PREFIX = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX ?? '';
  const s = raw.replace(/^["']|["']$/g, '').trim().replace(/^\/+|\/+$/g, '');
  return s;
})();
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
// Only intentionally-public families may map to the public Bunny CDN. `voice/` and `media/`
// (always private chat media) were removed: they must resolve through the authorized
// `get-chat-media-url` resolver, never the public CDN. Defense-in-depth (mirrors web).
const CONFIRMED_BUNNY_STORAGE_PREFIXES = ['photos/', 'events/'];
type ImageDerivativePathSet = { thumb?: string; display?: string; hero?: string };
const imageDerivativePathsByOriginalPath = new Map<string, ImageDerivativePathSet>();

if (__DEV__ && !BUNNY_CDN && typeof global !== 'undefined') {
  const g = global as unknown as { __vibelyBunnyCdnLogged?: boolean };
  if (!g.__vibelyBunnyCdnLogged) {
    g.__vibelyBunnyCdnLogged = true;
    console.warn('[Vibely] EXPO_PUBLIC_BUNNY_CDN_HOSTNAME is unset; Bunny-backed media paths will show placeholder. Set it in apps/mobile/.env and restart Metro.');
  }
}

const PLACEHOLDER = 'https://placehold.co/200x200?text=Photo';

export type PhotoTraceLabel = 'avatar' | 'profile_photo' | 'event_image';

const tracedLabels = __DEV__ ? new Set<PhotoTraceLabel>() : null;

function normalizeImagePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
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

  if (out.startsWith('//')) return `https:${out}`;
  if (out.startsWith('/')) out = out.replace(/^\/+/, '');
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

function derivativeStoragePathForDisplay(
  storagePath: string,
  opts?: { width?: number; height?: number; quality?: number; crop?: 'center' | 'top' | 'bottom' },
): string {
  const clean = stripBunnyStorageDecorations(storagePath);
  const requestedEdge = Math.max(
    typeof opts?.width === 'number' && Number.isFinite(opts.width) ? opts.width : 0,
    typeof opts?.height === 'number' && Number.isFinite(opts.height) ? opts.height : 0,
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
  // Intended display size. Confirmed upload-time derivatives may use this to pick a right-sized object.
  opts?: { width?: number; height?: number; quality?: number; crop?: 'center' | 'top' | 'bottom' },
  traceLabel?: PhotoTraceLabel
): string {
  const p = normalizeImagePath(path);
  if (!p) {
    return PLACEHOLDER;
  }
  if (p.includes('supabase.co') || p.includes('supabase.in')) return p;
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
    if (BUNNY_CDN && p.startsWith(`${BUNNY_CDN}/`)) {
      return stripBunnyStorageDecorations(p);
    }
    return p;
  }
  // Never public-map a private chat-scoped ref; these must flow through get-chat-media-url.
  if (isPrivateChatScopedStoragePath(p)) return PLACEHOLDER;
  if (CONFIRMED_BUNNY_STORAGE_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    if (!BUNNY_CDN) {
      return PLACEHOLDER;
    }
    const storagePath = derivativeStoragePathForDisplay(p, opts);
    const pathPart = BUNNY_CDN_PATH_PREFIX ? `${BUNNY_CDN_PATH_PREFIX}/${storagePath}` : storagePath;
    const url = `${BUNNY_CDN}/${pathPart}`;
    if (__DEV__ && traceLabel && tracedLabels && !tracedLabels.has(traceLabel)) {
      tracedLabels.add(traceLabel);
      if (__DEV__) console.log(`[Vibely photo URL] ${traceLabel}: ${url}`);
    }
    return url;
  }
  const url = `${SUPABASE_URL}/storage/v1/object/public/${p}`;
  if (__DEV__ && traceLabel && tracedLabels && !tracedLabels.has(traceLabel)) {
    tracedLabels.add(traceLabel);
    if (__DEV__) console.log(`[Vibely photo URL] ${traceLabel}: ${url}`);
  }
  return url;
}

function appendImageVersion(url: string, mediaVersion?: string | number | null): string {
  const version =
    typeof mediaVersion === 'number' && Number.isFinite(mediaVersion)
      ? String(mediaVersion)
      : typeof mediaVersion === 'string'
        ? mediaVersion.trim()
        : '';
  if (!url || !version || url === PLACEHOLDER || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

export function avatarUrl(
  path: string | null | undefined,
  traceLabel?: 'avatar' | 'profile_photo',
  mediaVersion?: string | number | null,
): string {
  return appendImageVersion(getImageUrl(path, { width: 200, height: 200, crop: 'center' }, traceLabel), mediaVersion);
}

export function deckCardUrl(path: string | null | undefined, mediaVersion?: string | number | null): string {
  return appendImageVersion(getImageUrl(path, { width: 1080, height: 1440, crop: 'center', quality: 88 }), mediaVersion);
}

export function eventCoverUrl(path: string | null | undefined, traceLabel?: 'event_image'): string {
  return getImageUrl(path, { width: 600, quality: 85 }, traceLabel);
}
