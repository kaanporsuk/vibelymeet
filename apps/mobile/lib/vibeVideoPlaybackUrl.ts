/**
 * Canonical Bunny Stream hostname + URL construction for native Vibe Video.
 * Playback hostname: EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME (trimmed) when set; else AsyncStorage
 * `bunny_stream_cdn_hostname` from create-video-upload; else hardcoded production Stream pull zone.
 * Same URL shape as web.
 *
 * Policy: when env is set, playback/thumbnail URLs use env (matches release builds / web).
 * Edge `cdnHostname` is persisted for devices without env. If env and persisted differ,
 * __DEV__ warns (CDN misconfiguration / stale cache); production uses env only.
 * A non-empty hostname is always available for URL construction (hardcoded fallback last).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

export const BUNNY_STREAM_CDN_STORAGE_KEY = 'bunny_stream_cdn_hostname';
export const BUNNY_STREAM_CDN_STORAGE_KEY_PREFIX = 'bunny_stream_cdn_hostname:';

/** Production Bunny Stream CDN hostname — last-resort fallback when env and storage are empty. */
export const STREAM_CDN_FALLBACK_HOST = 'vz-5585ddfc-604.b-cdn.net';

export const STREAM_CDN_HOSTNAME = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '';
  return raw.replace(/^["']|["']$/g, '').trim();
})();

export const SUPABASE_PROJECT_REF = (() => {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  try {
    const host = new URL(raw).hostname;
    return host.split('.')[0]?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
})();

function getProjectScopedStorageKey(): string {
  if (!SUPABASE_PROJECT_REF || SUPABASE_PROJECT_REF === 'unknown') {
    return BUNNY_STREAM_CDN_STORAGE_KEY;
  }
  return `${BUNNY_STREAM_CDN_STORAGE_KEY_PREFIX}${SUPABASE_PROJECT_REF}`;
}

/** Normalize hostname: no scheme, no path, lowercase. */
export function normalizeStreamCdnHostname(input: string): string {
  let h = String(input)
    .trim()
    .replace(/^["']|["']$/g, '');
  h = h.replace(/^https?:\/\//i, '');
  const slash = h.indexOf('/');
  if (slash >= 0) h = h.slice(0, slash);
  return h.trim().toLowerCase();
}

const STREAM_CDN_FALLBACK_NORMALIZED = normalizeStreamCdnHostname(STREAM_CDN_FALLBACK_HOST);

/**
 * Persisted edge hostname (AsyncStorage) — null until init or persist. When env is unset,
 * defaults to fallback normalized so sync resolution works before init completes.
 */
let cachedCdnHostname: string | null = STREAM_CDN_HOSTNAME
  ? null
  : STREAM_CDN_FALLBACK_NORMALIZED;

let warnedMissingHostForPlayback = false;
let warnedInitMissing = false;

export type StreamHostnameSource = 'env' | 'persisted' | 'fallback';

export type StreamHostnameResolution = {
  /** Hostname used for `https://${hostname}/${uid}/playlist.m3u8` — always non-empty. */
  hostname: string;
  source: StreamHostnameSource;
  /** True when env and persisted cache are both non-empty and differ after normalization. */
  envPersistedMismatch: boolean;
};

/**
 * Single canonical resolver for stream CDN hostname (sync). All playback/thumbnail URLs must use this.
 *
 * Hostname resolution priority:
 * 1. EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME env var (build-time, most reliable)
 * 2. AsyncStorage persisted value from last create-video-upload Edge call
 * 3. Hardcoded fallback (STREAM_CDN_FALLBACK_HOST)
 * A non-empty hostname is always returned.
 */
export function resolveVibeVideoStreamHostnameSync(): StreamHostnameResolution {
  const envRaw = STREAM_CDN_HOSTNAME;
  const env = envRaw ? normalizeStreamCdnHostname(envRaw) : '';
  const persistedRaw = (cachedCdnHostname ?? '').trim();
  const persisted = persistedRaw ? normalizeStreamCdnHostname(persistedRaw) : '';

  const envPersistedMismatch = !!(env && persisted && env !== persisted);

  if (__DEV__ && envPersistedMismatch) {
    console.warn(
      '[VibeVideo] CDN hostname mismatch: EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME !== persisted edge hostname. ' +
        'Using env for URL construction. If you see 403/empty manifest, align env with Edge or clear app data.',
      { env, persisted },
    );
  }

  if (env) {
    return { hostname: env, source: 'env', envPersistedMismatch };
  }
  if (persisted) {
    return { hostname: persisted, source: 'persisted', envPersistedMismatch: false };
  }
  return {
    hostname: STREAM_CDN_FALLBACK_NORMALIZED,
    source: 'fallback',
    envPersistedMismatch: false,
  };
}

/** In-memory cache update (e.g. after reading AsyncStorage). */
export function setCachedStreamCdnHostname(hostname: string | null | undefined): void {
  if (hostname && String(hostname).trim()) {
    cachedCdnHostname = normalizeStreamCdnHostname(String(hostname));
  }
}

/**
 * Call after successful create-video-upload: persist authoritative edge hostname, refresh memory cache.
 */
export async function persistStreamCdnHostnameFromEdge(edgeHostname: string | null | undefined): Promise<void> {
  if (!edgeHostname || !String(edgeHostname).trim()) return;
  const normalized = normalizeStreamCdnHostname(String(edgeHostname));
  try {
    await AsyncStorage.setItem(getProjectScopedStorageKey(), normalized);
    // Best-effort migration path from legacy key to project-scoped key.
    await AsyncStorage.setItem(BUNNY_STREAM_CDN_STORAGE_KEY, normalized);
  } catch (e) {
    if (__DEV__) console.warn('[VibeVideo] AsyncStorage.setItem(cdn hostname) failed:', e);
  }
  cachedCdnHostname = normalized;
  vibeVideoDiagVerbose('playback.hostname.persisted_from_edge', {
    projectRef: SUPABASE_PROJECT_REF,
    hostname: normalized,
    storageKey: getProjectScopedStorageKey(),
  });

  const env = STREAM_CDN_HOSTNAME ? normalizeStreamCdnHostname(STREAM_CDN_HOSTNAME) : '';
  if (__DEV__ && env && env !== normalized) {
    console.warn('[VibeVideo] Edge cdnHostname differs from EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME.', {
      edge: normalized,
      env,
    });
  }
}

export async function initStreamCdnHostname(): Promise<void> {
  if (STREAM_CDN_HOSTNAME) {
    cachedCdnHostname = normalizeStreamCdnHostname(STREAM_CDN_HOSTNAME);
    vibeVideoDiagVerbose('playback.hostname.init', {
      source: 'env',
      projectRef: SUPABASE_PROJECT_REF,
      hostname: cachedCdnHostname,
    });
    return;
  }
  try {
    const scopedKey = getProjectScopedStorageKey();
    const scopedStored = await AsyncStorage.getItem(scopedKey);
    const legacyStored = await AsyncStorage.getItem(BUNNY_STREAM_CDN_STORAGE_KEY);
    const effectiveStored = scopedStored?.trim() ? scopedStored : legacyStored;
    if (effectiveStored?.trim()) {
      cachedCdnHostname = normalizeStreamCdnHostname(effectiveStored);
    } else {
      cachedCdnHostname = STREAM_CDN_FALLBACK_NORMALIZED;
    }
  } catch {
    cachedCdnHostname = STREAM_CDN_FALLBACK_NORMALIZED;
  }
  vibeVideoDiagVerbose('playback.hostname.init', {
    source: cachedCdnHostname === STREAM_CDN_FALLBACK_NORMALIZED ? 'fallback' : 'persisted',
    projectRef: SUPABASE_PROJECT_REF,
    hostname: cachedCdnHostname,
    storageKey: getProjectScopedStorageKey(),
  });

  if (__DEV__ && !STREAM_CDN_HOSTNAME && !warnedInitMissing) {
    warnedInitMissing = true;
    console.warn(
      '[VibeVideo] EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME unset — using persisted or default Stream CDN hostname.',
    );
  }
}

// Per-UID set so playback.url.resolved only logs once per session in dev.
const loggedPlaybackUids = new Set<string>();

/** Canonical playback URL; null only when uid is missing (hostname is always resolved). */
export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname, source } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (__DEV__ && uid && !hostname && !warnedMissingHostForPlayback) {
    warnedMissingHostForPlayback = true;
    console.warn('[VibeVideo] Cannot build playback URL: missing video uid or hostname resolution failed.');
  }
  if (!uid || !hostname) return null;
  const url = `https://${hostname}/${uid}/playlist.m3u8`;
  if (!loggedPlaybackUids.has(uid)) {
    loggedPlaybackUids.add(uid);
    vibeVideoDiagVerbose('playback.url.resolved', {
      uid,
      hostname,
      hostnameSource: source,
      projectRef: SUPABASE_PROJECT_REF,
      url,
    });
  }
  return url;
}

/** Canonical thumbnail URL; null only when uid is missing. */
export function getVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/thumbnail.jpg`;
}
