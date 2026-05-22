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
const CONFIRMED_BUNNY_STORAGE_PREFIXES = ['photos/', 'events/', 'voice/', 'media/'];
const imageDerivativePathsByOriginalPath = new Map<string, { thumb?: string; hero?: string }>();

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
  derivatives: { thumb?: string | null; hero?: string | null } | null | undefined,
): void {
  const normalized = normalizeImagePath(originalPath);
  if (!normalized || !derivatives) return;
  const clean = stripBunnyStorageDecorations(normalized);
  const thumb = normalizeImagePath(derivatives.thumb)?.trim();
  const hero = normalizeImagePath(derivatives.hero)?.trim();
  if (!thumb && !hero) return;
  imageDerivativePathsByOriginalPath.set(clean, {
    ...(thumb ? { thumb: stripBunnyStorageDecorations(thumb) } : {}),
    ...(hero ? { hero: stripBunnyStorageDecorations(hero) } : {}),
  });
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
  if (knownDerivatives && requestedEdge > 0 && requestedEdge <= 420 && knownDerivatives.thumb) {
    return knownDerivatives.thumb;
  }
  if (knownDerivatives && requestedEdge > 0 && requestedEdge <= 1400 && knownDerivatives.hero) {
    return knownDerivatives.hero;
  }

  if (!/@orig\.[a-z0-9]+$/i.test(clean)) return clean;

  if (requestedEdge > 0 && requestedEdge <= 420) {
    return clean.replace(/@orig\.([a-z0-9]+)$/i, '@thumb.$1');
  }
  if (requestedEdge > 0 && requestedEdge <= 1400) {
    return clean.replace(/@orig\.([a-z0-9]+)$/i, '@hero.$1');
  }
  return clean;
}

export function getImageUrl(
  path: string | null | undefined,
  // Intended display size. Derivative-ready Bunny paths can use this to pick a right-sized object.
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

export function avatarUrl(path: string | null | undefined, traceLabel?: 'avatar' | 'profile_photo'): string {
  return getImageUrl(path, { width: 200, height: 200, crop: 'center' }, traceLabel);
}

export function deckCardUrl(path: string | null | undefined): string {
  return getImageUrl(path, { width: 1080, height: 1440, crop: 'center', quality: 88 });
}

export function eventCoverUrl(path: string | null | undefined, traceLabel?: 'event_image'): string {
  return getImageUrl(path, { width: 600, quality: 85 }, traceLabel);
}
