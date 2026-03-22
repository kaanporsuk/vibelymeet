/**
 * Canonical Bunny Stream hostname + URL construction for native Vibe Video.
 * Playback hostname: EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME (trimmed) when set; else AsyncStorage
 * `bunny_stream_cdn_hostname` from create-video-upload. Same URL shape as web.
 *
 * Policy: when env is set, playback/thumbnail URLs always use env (matches release builds / web).
 * Edge `cdnHostname` is always persisted for devices without env. If env and persisted differ,
 * __DEV__ warns (CDN misconfiguration / stale cache); production uses env only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BUNNY_STREAM_CDN_STORAGE_KEY = 'bunny_stream_cdn_hostname';

export const STREAM_CDN_HOSTNAME = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '';
  return raw.replace(/^["']|["']$/g, '').trim();
})();

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

let cachedCdnHostname: string | null = null;
let warnedMissingHostForPlayback = false;
let warnedInitMissing = false;

export type StreamHostnameSource = 'env' | 'persisted' | 'none';

export type StreamHostnameResolution = {
  /** Hostname used for `https://${hostname}/${uid}/playlist.m3u8` */
  hostname: string;
  source: StreamHostnameSource;
  /** True when env and persisted cache are both non-empty and differ after normalization. */
  envPersistedMismatch: boolean;
};

/**
 * Single canonical resolver for stream CDN hostname (sync). All playback/thumbnail URLs must use this.
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
  return { hostname: '', source: 'none', envPersistedMismatch: false };
}

/** @deprecated Use resolveVibeVideoStreamHostnameSync().hostname — kept for incremental refactors */
export function getEffectiveStreamCdnHostnameSync(): string {
  return resolveVibeVideoStreamHostnameSync().hostname;
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
    await AsyncStorage.setItem(BUNNY_STREAM_CDN_STORAGE_KEY, normalized);
  } catch (e) {
    if (__DEV__) console.warn('[VibeVideo] AsyncStorage.setItem(cdn hostname) failed:', e);
  }
  cachedCdnHostname = normalized;

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
    return;
  }
  try {
    const stored = await AsyncStorage.getItem(BUNNY_STREAM_CDN_STORAGE_KEY);
    if (stored?.trim()) {
      cachedCdnHostname = normalizeStreamCdnHostname(stored);
    }
  } catch {
    /* ignore */
  }

  const { hostname, source } = resolveVibeVideoStreamHostnameSync();
  if (__DEV__ && !hostname && !warnedInitMissing) {
    warnedInitMissing = true;
    console.warn(
      '[VibeVideo] No stream CDN hostname: set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME or complete an upload ' +
        'so create-video-upload can persist bunny_stream_cdn_hostname.',
      { source },
    );
  }
}

/** Canonical playback URL; null if no hostname or uid. */
export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (__DEV__ && uid && !hostname && !warnedMissingHostForPlayback) {
    warnedMissingHostForPlayback = true;
    console.warn(
      '[VibeVideo] Cannot build playback URL: missing CDN hostname (env empty and no persisted edge hostname).',
    );
  }
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/playlist.m3u8`;
}

/** Canonical thumbnail URL; null if no hostname or uid. */
export function getVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/thumbnail.jpg`;
}
