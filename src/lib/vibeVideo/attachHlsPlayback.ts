import type HlsInstance from "hls.js";
import { canPrewarmMedia, isMediaPlaybackQoeDegraded } from "@/lib/mediaPlaybackSessionPolicy";

export type HlsPlaybackErrorKind = "native" | "unsupported" | "fatal";

export type HlsAuthErrorRefreshDetail = {
  attempt: number;
  maxAttempts: number;
  playbackMode: "hls_js" | "native";
  statusCode: number | null;
  errorType: string | null;
  errorDetails: string | null;
};

type AttachHlsPlaybackOptions = {
  autoPlay?: boolean;
  onAutoplayBlocked?: (detail?: unknown) => void;
  onError?: (kind: HlsPlaybackErrorKind, detail?: unknown) => void;
  onAuthErrorRefresh?: (
    detail: HlsAuthErrorRefreshDetail,
  ) => Promise<string | null | undefined> | string | null | undefined;
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

function constrainHlsAbrForDegradedQoe(hls: HlsInstance): void {
  const levels = Array.isArray(hls.levels) ? hls.levels : [];
  if (!levels.length) return;
  hls.autoLevelCapping = Math.min(1, levels.length - 1);
  hls.startLevel = 0;
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

export function attachHlsPlayback(
  videoEl: HTMLVideoElement,
  src: string,
  options: AttachHlsPlaybackOptions = {},
): () => void {
  const {
    autoPlay = true,
    onAutoplayBlocked,
    onError,
    onAuthErrorRefresh,
    authErrorRefreshMaxAttempts = 2,
    onManifestParsed,
  } = options;
  const constrainAbr = isMediaPlaybackQoeDegraded();
  const maxAuthRefreshAttempts = Math.max(0, authErrorRefreshMaxAttempts);
  const useNativeHls = !!videoEl.canPlayType("application/vnd.apple.mpegurl");
  let cancelled = false;
  let errorReported = false;
  let authRefreshAttempts = 0;
  let authRefreshInFlight = false;
  let currentSrc = src;
  let hls: HlsInstance | null = null;

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

  const refreshAfterAuthError = (
    playbackMode: HlsAuthErrorRefreshDetail["playbackMode"],
    data: HlsErrorData | undefined,
    applySource: (freshSrc: string) => void,
    onUnavailable: () => void,
  ): boolean => {
    if (!onAuthErrorRefresh || authRefreshInFlight || authRefreshAttempts >= maxAuthRefreshAttempts) return false;
    const statusCode = hlsErrorStatusCode(data);
    if (playbackMode === "hls_js" && !isAuthStatusCode(statusCode)) return false;

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
        if (!freshSrc) {
          onUnavailable();
          return;
        }
        currentSrc = freshSrc;
        errorReported = false;
        applySource(freshSrc);
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
    videoEl.src = currentSrc;
    videoEl.load();
    playIfNeeded();
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
        hls.loadSource(currentSrc);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          if (constrainAbr && hls) constrainHlsAbrForDegradedQoe(hls);
          onManifestParsed?.();
          playIfNeeded();
        });
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
              (freshSrc) => {
                if (!hls) return;
                hls.loadSource(freshSrc);
                if (typeof hls.startLoad === "function") hls.startLoad();
                playIfNeeded();
              },
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
    videoEl.removeEventListener("error", onVideoError);
    if (hls) {
      hls.destroy();
      hls = null;
    }
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();
  };
}
