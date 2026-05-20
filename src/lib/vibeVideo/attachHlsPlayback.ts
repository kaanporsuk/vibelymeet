import type HlsInstance from "hls.js";

type HlsPlaybackErrorKind = "native" | "unsupported" | "fatal";

type AttachHlsPlaybackOptions = {
  autoPlay?: boolean;
  onAutoplayBlocked?: (detail?: unknown) => void;
  onError?: (kind: HlsPlaybackErrorKind, detail?: unknown) => void;
  onManifestParsed?: () => void;
};

type HlsModule = { default: typeof import("hls.js").default };
type HlsLoader = () => Promise<HlsModule>;

let hlsLoader: HlsLoader = () => import("hls.js");

export function __setHlsLoaderForTest(loader: HlsLoader | null): void {
  hlsLoader = loader ?? (() => import("hls.js"));
}

export function attachHlsPlayback(
  videoEl: HTMLVideoElement,
  src: string,
  options: AttachHlsPlaybackOptions = {},
): () => void {
  const { autoPlay = true, onAutoplayBlocked, onError, onManifestParsed } = options;
  let cancelled = false;
  let errorReported = false;
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

  const onVideoError = () => {
    reportError("native");
  };

  videoEl.addEventListener("error", onVideoError);

  if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
    videoEl.src = src;
    videoEl.load();
    playIfNeeded();
  } else {
    void hlsLoader().then(({ default: Hls }) => {
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
      hls.loadSource(src);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
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
      hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
        if (!cancelled && data.fatal) {
          reportError("fatal", data);
        }
      });
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
