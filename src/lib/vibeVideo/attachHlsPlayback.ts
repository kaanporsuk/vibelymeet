import type HlsInstance from "hls.js";
import {
  canPrewarmMedia,
  isMediaPlaybackQoeDegraded,
  mediaConnectionSnapshot,
  mediaPlaybackAbrPolicy,
} from "@/lib/mediaPlaybackSessionPolicy";

export type HlsPlaybackErrorKind = "native" | "unsupported" | "fatal";

export type HlsAuthErrorRefreshDetail = {
  attempt: number;
  maxAttempts: number;
  playbackMode: "hls_js" | "native";
  statusCode: number | null;
  errorType: string | null;
  errorDetails: string | null;
};

export type HlsPlaybackRefreshResult =
  | string
  | { url?: string | null; expiresAtMs?: number | null }
  | null
  | undefined;

type AttachHlsPlaybackOptions = {
  autoPlay?: boolean;
  expiresAtMs?: number | null;
  onAutoplayBlocked?: (detail?: unknown) => void;
  onError?: (kind: HlsPlaybackErrorKind, detail?: unknown) => void;
  onAuthErrorRefresh?: (
    detail: HlsAuthErrorRefreshDetail,
  ) => Promise<HlsPlaybackRefreshResult> | HlsPlaybackRefreshResult;
  onProactiveRefresh?: () => Promise<HlsPlaybackRefreshResult> | HlsPlaybackRefreshResult;
  authErrorRefreshMaxAttempts?: number;
  onManifestParsed?: () => void;
};

type HlsModule = { default: typeof import("hls.js").default };
type HlsLoader = () => Promise<HlsModule>;
type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
  response?: { code?: number; status?: number } | null;
  networkDetails?: { status?: number; statusCode?: number } | null;
};

let hlsLoader: HlsLoader = () => import("hls.js");
let hlsPreloadPromise: Promise<HlsModule> | null = null;
const HLS_LIBRARY_PRELOAD_ESTIMATE_BYTES = 320 * 1024;
const PLAYBACK_PROACTIVE_REFRESH_LEAD_MS = 60 * 1000;
const PLAYBACK_PROACTIVE_REFRESH_RETRY_MS = 5 * 1000;

export function __setHlsLoaderForTest(loader: HlsLoader | null): void {
  hlsLoader = loader ?? (() => import("hls.js"));
  hlsPreloadPromise = null;
}

function loadHlsModule(): Promise<HlsModule> {
  if (!hlsPreloadPromise) {
    hlsPreloadPromise = hlsLoader().catch((error: unknown) => {
      hlsPreloadPromise = null;
      throw error;
    });
  }
  return hlsPreloadPromise;
}

export function preloadHlsPlaybackLibrary(): void {
  if (typeof document === "undefined") return;
  if (!canPrewarmMedia(HLS_LIBRARY_PRELOAD_ESTIMATE_BYTES)) return;
  const videoEl = document.createElement("video");
  if (videoEl.canPlayType("application/vnd.apple.mpegurl")) return;
  void loadHlsModule().catch(() => {});
}

function levelHeight(level: unknown): number | null {
  const height = (level as { height?: unknown } | null)?.height;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : null;
}

function applyHlsAbrPolicy(hls: HlsInstance): void {
  const levels = Array.isArray(hls.levels) ? hls.levels : [];
  if (!levels.length) return;
  const policy = mediaPlaybackAbrPolicy(mediaConnectionSnapshot(), isMediaPlaybackQoeDegraded());
  const maxHeight = policy.maxHeight;
  if (!maxHeight) return;
  const cappedIndex = levels.reduce((bestIndex, level, index) => {
    const height = levelHeight(level);
    if (height === null || height > maxHeight) return bestIndex;
    if (bestIndex < 0) return index;
    const bestHeight = levelHeight(levels[bestIndex]) ?? 0;
    return height >= bestHeight ? index : bestIndex;
  }, -1);
  hls.autoLevelCapping = cappedIndex >= 0 ? cappedIndex : 0;
  hls.startLevel = Math.min(Math.max(0, hls.autoLevelCapping), levels.length - 1);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hlsErrorStatusCode(data: HlsErrorData | undefined): number | null {
  if (!data) return null;
  return (
    numberOrNull(data.response?.code) ??
    numberOrNull(data.response?.status) ??
    numberOrNull(data.networkDetails?.status) ??
    numberOrNull(data.networkDetails?.statusCode)
  );
}

function isAuthStatusCode(statusCode: number | null): boolean {
  return statusCode === 401 || statusCode === 403;
}

function isNetworkHlsError(data: HlsErrorData | undefined): boolean {
  if (typeof data?.type !== "string") return true;
  return /network/i.test(data.type);
}

function normalizeRefreshResult(result: HlsPlaybackRefreshResult): { url: string | null; expiresAtMs: number | null } {
  if (typeof result === "string") return { url: result, expiresAtMs: null };
  const url = typeof result?.url === "string" && result.url ? result.url : null;
  const expiresAtMs =
    typeof result?.expiresAtMs === "number" && Number.isFinite(result.expiresAtMs)
      ? result.expiresAtMs
      : null;
  return { url, expiresAtMs };
}

export function attachHlsPlayback(
  videoEl: HTMLVideoElement,
  src: string,
  options: AttachHlsPlaybackOptions = {},
): () => void {
  const {
    autoPlay = true,
    expiresAtMs = null,
    onAutoplayBlocked,
    onError,
    onAuthErrorRefresh,
    onProactiveRefresh,
    authErrorRefreshMaxAttempts = 2,
    onManifestParsed,
  } = options;
  const maxAuthRefreshAttempts = Math.max(0, authErrorRefreshMaxAttempts);
  const useNativeHls = !!videoEl.canPlayType("application/vnd.apple.mpegurl");
  let cancelled = false;
  let errorReported = false;
  let authRefreshAttempts = 0;
  let authRefreshInFlight = false;
  let currentSrc = src;
  let currentExpiresAtMs =
    typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) ? expiresAtMs : null;
  let hls: HlsInstance | null = null;
  let proactiveRefreshInFlight = false;
  let proactiveRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  let proactivePlayListener: (() => void) | null = null;

  const playIfNeeded = () => {
    if (!autoPlay || cancelled) return;
    void videoEl.play().catch((error: unknown) => {
      if (!cancelled) onAutoplayBlocked?.(error);
    });
  };

  const reportError = (kind: HlsPlaybackErrorKind, detail?: unknown) => {
    if (cancelled || errorReported) return;
    errorReported = true;
    onError?.(kind, detail);
  };

  const clearProactiveRefreshTimer = () => {
    if (proactiveRefreshTimeout !== null) clearTimeout(proactiveRefreshTimeout);
    proactiveRefreshTimeout = null;
  };

  const isActivelyPlaying = () => !videoEl.paused && !videoEl.ended && videoEl.readyState >= 2;

  const updateSourceState = (freshSrc: string, freshExpiresAtMs: number | null) => {
    currentSrc = freshSrc;
    errorReported = false;
    currentExpiresAtMs = freshExpiresAtMs;
  };

  const armProactiveRefresh = (applySource: (freshSrc: string) => void) => {
    clearProactiveRefreshTimer();
    if (!onProactiveRefresh || !currentExpiresAtMs || !Number.isFinite(currentExpiresAtMs)) return;
    const delayMs = currentExpiresAtMs - Date.now() - PLAYBACK_PROACTIVE_REFRESH_LEAD_MS;
    proactiveRefreshTimeout = setTimeout(() => {
      runProactiveRefresh(applySource);
    }, Math.max(0, delayMs));
  };

  const scheduleProactiveRefreshRetry = (applySource: (freshSrc: string) => void) => {
    clearProactiveRefreshTimer();
    if (!currentExpiresAtMs || !Number.isFinite(currentExpiresAtMs)) return;
    const remainingMs = currentExpiresAtMs - Date.now();
    if (remainingMs <= 0) return;
    proactiveRefreshTimeout = setTimeout(() => {
      runProactiveRefresh(applySource);
    }, Math.min(PLAYBACK_PROACTIVE_REFRESH_RETRY_MS, remainingMs));
  };

  const runProactiveRefresh = (applySource: (freshSrc: string) => void) => {
    if (cancelled || proactiveRefreshInFlight || authRefreshInFlight || !onProactiveRefresh) return;
    if (!currentExpiresAtMs || !Number.isFinite(currentExpiresAtMs)) return;
    const remainingMs = currentExpiresAtMs - Date.now();
    if (remainingMs <= 0) return;
    if (!isActivelyPlaying()) {
      scheduleProactiveRefreshRetry(applySource);
      return;
    }

    let retry = false;
    proactiveRefreshInFlight = true;
    void Promise.resolve(onProactiveRefresh())
      .then((result) => {
        if (cancelled) return;
        const fresh = normalizeRefreshResult(result);
        if (!fresh.url) {
          retry = true;
          return;
        }
        updateSourceState(fresh.url, fresh.expiresAtMs);
        applySource(fresh.url);
      })
      .catch(() => {
        retry = true;
      })
      .finally(() => {
        proactiveRefreshInFlight = false;
        if (cancelled) return;
        if (retry) {
          scheduleProactiveRefreshRetry(applySource);
        } else {
          armProactiveRefresh(applySource);
        }
      });
  };

  const proactiveRefreshOnPlay = (applySource: (freshSrc: string) => void) => {
    if (!currentExpiresAtMs || currentExpiresAtMs - Date.now() > PLAYBACK_PROACTIVE_REFRESH_LEAD_MS) return;
    runProactiveRefresh(applySource);
  };

  const refreshAfterAuthError = (
    playbackMode: HlsAuthErrorRefreshDetail["playbackMode"],
    data: HlsErrorData | undefined,
    applySource: (freshSrc: string) => void,
    onUnavailable: () => void,
  ): boolean => {
    if (!onAuthErrorRefresh || authRefreshInFlight || authRefreshAttempts >= maxAuthRefreshAttempts) return false;
    const statusCode = hlsErrorStatusCode(data);
    if (playbackMode === "hls_js" && (!isAuthStatusCode(statusCode) || !isNetworkHlsError(data))) return false;

    authRefreshAttempts += 1;
    authRefreshInFlight = true;
    const detail: HlsAuthErrorRefreshDetail = {
      attempt: authRefreshAttempts,
      maxAttempts: maxAuthRefreshAttempts,
      playbackMode,
      statusCode,
      errorType: typeof data?.type === "string" ? data.type : null,
      errorDetails: typeof data?.details === "string" ? data.details : null,
    };

    void Promise.resolve(onAuthErrorRefresh(detail))
      .then((freshSrc) => {
        if (cancelled) return;
        const fresh = normalizeRefreshResult(freshSrc);
        if (!fresh.url) {
          onUnavailable();
          return;
        }
        updateSourceState(fresh.url, fresh.expiresAtMs);
        applySource(fresh.url);
        armProactiveRefresh(applySource);
      })
      .catch(onUnavailable)
      .finally(() => {
        authRefreshInFlight = false;
      });
    return true;
  };

  const onVideoError = () => {
    if (useNativeHls && authRefreshInFlight) return;
    if (
      useNativeHls &&
      refreshAfterAuthError(
        "native",
        undefined,
        (freshSrc) => {
          videoEl.src = freshSrc;
          videoEl.load();
          playIfNeeded();
        },
        () => reportError("native"),
      )
    ) {
      return;
    }
    reportError("native");
  };

  videoEl.addEventListener("error", onVideoError);

  if (useNativeHls) {
    const applyNativeSource = (freshSrc: string) => {
      videoEl.src = freshSrc;
      videoEl.load();
      playIfNeeded();
    };
    videoEl.src = currentSrc;
    videoEl.load();
    playIfNeeded();
    armProactiveRefresh(applyNativeSource);
    proactivePlayListener = () => proactiveRefreshOnPlay(applyNativeSource);
    videoEl.addEventListener("play", proactivePlayListener);
    videoEl.addEventListener("playing", proactivePlayListener);
  } else {
    void loadHlsModule()
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          reportError("unsupported");
          return;
        }

        hls = new Hls({
          fragLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
          manifestLoadingMaxRetry: 1,
        });
        const applyHlsSource = (freshSrc: string) => {
          if (!hls) return;
          hls.loadSource(freshSrc);
          if (typeof hls.startLoad === "function") hls.startLoad();
          playIfNeeded();
        };
        hls.loadSource(currentSrc);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          if (hls) applyHlsAbrPolicy(hls);
          onManifestParsed?.();
          playIfNeeded();
          armProactiveRefresh(applyHlsSource);
        });
        proactivePlayListener = () => proactiveRefreshOnPlay(applyHlsSource);
        videoEl.addEventListener("play", proactivePlayListener);
        videoEl.addEventListener("playing", proactivePlayListener);
        hls.on(Hls.Events.LEVEL_SWITCHED, () => {
          if (cancelled) return;
          const event = typeof CustomEvent === "function"
            ? new CustomEvent("vibely-hls-level-switched")
            : new Event("vibely-hls-level-switched");
          videoEl.dispatchEvent(event);
        });
        hls.on(Hls.Events.ERROR, (_event: unknown, data: HlsErrorData) => {
          if (cancelled) return;
          if (authRefreshInFlight && isAuthStatusCode(hlsErrorStatusCode(data))) return;
          if (
            refreshAfterAuthError(
              "hls_js",
              data,
              applyHlsSource,
              () => {
                if (data.fatal) reportError("fatal", data);
              },
            )
          ) {
            return;
          }
          if (data.fatal) {
            reportError("fatal", data);
          }
        });
      })
      .catch((error: unknown) => {
        reportError("unsupported", error);
      });
  }

  return () => {
    cancelled = true;
    clearProactiveRefreshTimer();
    videoEl.removeEventListener("error", onVideoError);
    if (proactivePlayListener) {
      videoEl.removeEventListener("play", proactivePlayListener);
      videoEl.removeEventListener("playing", proactivePlayListener);
      proactivePlayListener = null;
    }
    if (hls) {
      hls.destroy();
      hls = null;
    }
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();
  };
}
