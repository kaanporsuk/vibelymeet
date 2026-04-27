import type HlsInstance from "hls.js";

type HlsPlaybackErrorKind = "native" | "unsupported" | "fatal";

type AttachHlsPlaybackOptions = {
  autoPlay?: boolean;
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
  const { autoPlay = true, onError, onManifestParsed } = options;
  let cancelled = false;
  let hls: HlsInstance | null = null;

  const playIfNeeded = () => {
    if (!autoPlay || cancelled) return;
    void videoEl.play().catch(() => {});
  };

  const onVideoError = () => {
    if (!cancelled) onError?.("native");
  };

  videoEl.addEventListener("error", onVideoError);

  if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
    videoEl.src = src;
    playIfNeeded();
  } else {
    void hlsLoader().then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        onError?.("unsupported");
        return;
      }

      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        onManifestParsed?.();
        playIfNeeded();
      });
      hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
        if (!cancelled && data.fatal) {
          onError?.("fatal", data);
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
