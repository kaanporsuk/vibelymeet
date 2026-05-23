/**
 * Canonical Bunny Stream hostname + URL construction for native Vibe Video.
 * Playback hostname: EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME (trimmed) when set; else AsyncStorage
 * `bunny_stream_cdn_hostname` from create-video-upload; else no playback URL is constructed.
 * Same URL shape as web.
 *
 * Policy: when env is set, playback/thumbnail URLs use env (matches release builds / web).
 * Edge `cdnHostname` is persisted for devices without env. If env and persisted differ,
 * __DEV__ warns (CDN misconfiguration / stale cache); production uses env only.
 * Missing hostname emits a sparse production hint + telemetry event so release misconfiguration
 * is visible instead of silently masking provider/CDN drift with a hardcoded host.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { vibeVideoDiagProdHint, vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import { captureVibeVideoMessage, trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from '@/lib/vibeVideoTelemetry';

export const BUNNY_STREAM_CDN_STORAGE_KEY = 'bunny_stream_cdn_hostname';
export const BUNNY_STREAM_CDN_STORAGE_KEY_PREFIX = 'bunny_stream_cdn_hostname:';

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

/**
 * Persisted edge hostname (AsyncStorage) — null until init/persist finds a real persisted host.
 */
let cachedCdnHostname: string | null = null;

let warnedMissingHostForPlayback = false;
let warnedInitMissing = false;
let warnedMissingResolution = false;
let reportedEnvPersistedMismatch = false;

export type StreamHostnameSource = 'env' | 'persisted' | 'missing';

export type StreamHostnameResolution = {
  /** Hostname used for `https://${hostname}/${uid}/playlist.m3u8`; null when config is missing. */
  hostname: string | null;
  source: StreamHostnameSource;
  /** True when env and persisted cache are both non-empty and differ after normalization. */
  envPersistedMismatch: boolean;
  missingReason: string | null;
};

function trackCdnHostnamePersistenceMismatch(source: string): void {
  if (reportedEnvPersistedMismatch) return;
  reportedEnvPersistedMismatch = true;
  const properties = {
    source,
    kind: 'env_persisted_hostname_mismatch',
    stream_hostname_source: 'env',
    project_ref: SUPABASE_PROJECT_REF,
    env_hostname_present: true,
    persisted_hostname_present: true,
  };
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.cdnHostnamePersistenceMismatch, properties);
  captureVibeVideoMessage('vibe_video_cdn_hostname_persistence_mismatch', properties, 'warning');
}

/**
 * Single canonical resolver for stream CDN hostname (sync). All playback/thumbnail URLs must use this.
 *
 * Hostname resolution priority:
 * 1. EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME env var (build-time, most reliable)
 * 2. AsyncStorage persisted value from last create-video-upload Edge call
 * 3. Missing: return null and emit diagnostics/telemetry
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
  if (envPersistedMismatch) {
    trackCdnHostnamePersistenceMismatch('native_playback_hostname_resolver');
  }

  if (env) {
    return { hostname: env, source: 'env', envPersistedMismatch, missingReason: null };
  }
  if (persisted) {
    return { hostname: persisted, source: 'persisted', envPersistedMismatch: false, missingReason: null };
  }
  if (!warnedMissingResolution) {
    warnedMissingResolution = true;
    vibeVideoDiagProdHint(
      'playback.hostname.missing',
      'EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME and persisted edge hostname are both missing',
    );
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.cdnHostnameFallbackUsed, {
      source: 'native_playback_hostname_resolver',
      kind: 'cdn_hostname_missing',
      stream_hostname_source: 'missing',
    });
  }
  return {
    hostname: null,
    source: 'missing',
    envPersistedMismatch: false,
    missingReason: 'missing_env_and_persisted_hostname',
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
  if (env && env !== normalized) {
    trackCdnHostnamePersistenceMismatch('native_playback_hostname_persist');
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
      cachedCdnHostname = null;
    }
  } catch {
    cachedCdnHostname = null;
  }
  vibeVideoDiagVerbose('playback.hostname.init', {
    source: cachedCdnHostname ? 'persisted' : 'missing',
    projectRef: SUPABASE_PROJECT_REF,
    hostname: cachedCdnHostname,
    storageKey: getProjectScopedStorageKey(),
  });

  if (__DEV__ && !STREAM_CDN_HOSTNAME && !warnedInitMissing) {
    warnedInitMissing = true;
    console.warn(
      '[VibeVideo] EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME unset. Playback needs a persisted Edge cdnHostname before URLs can be built.',
    );
  }
}

// Per-UID set so playback.url.resolved only logs once per session in dev.
const loggedPlaybackUids = new Set<string>();

/** Canonical playback URL; null when uid or configured/persisted hostname is missing. */
export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname, source, missingReason } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (__DEV__ && uid && !hostname && !warnedMissingHostForPlayback) {
    warnedMissingHostForPlayback = true;
    console.warn('[VibeVideo] Cannot build playback URL: missing Stream CDN hostname.', { missingReason });
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
      urlKind: 'hls_manifest',
    });
  }
  return url;
}

/** Canonical thumbnail URL; null when uid or configured/persisted hostname is missing. */
export function getVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  const { hostname } = resolveVibeVideoStreamHostnameSync();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (!uid || !hostname) return null;
  return `https://${hostname}/${uid}/thumbnail.jpg`;
}
