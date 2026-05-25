export type MediaFallbackReason =
  | "auth_expired"
  | "asset_deleted"
  | "provider_unreachable"
  | "poster_unavailable"
  | "hls_auth_failed"
  | "unknown";

export type MediaFallbackRetryPolicy = "auto_refresh_once" | "manual_retry" | "no_retry";

export type MediaFallbackCopy = {
  title: string;
  message: string;
  actionLabel: string | null;
  retryPolicy: MediaFallbackRetryPolicy;
  telemetryReason: MediaFallbackReason;
};

export function resolveMediaFallbackCopy(input: {
  reason: MediaFallbackReason;
}): MediaFallbackCopy {
  switch (input.reason) {
    case "auth_expired":
      return {
        title: "Media access expired",
        message: "We are refreshing this media. Try again if it does not load.",
        actionLabel: "Retry",
        retryPolicy: "auto_refresh_once",
        telemetryReason: input.reason,
      };
    case "asset_deleted":
      return {
        title: "Media unavailable",
        message: "This media is no longer available.",
        actionLabel: null,
        retryPolicy: "no_retry",
        telemetryReason: input.reason,
      };
    case "provider_unreachable":
      return {
        title: "Media could not load",
        message: "The media service is unreachable right now. Try again in a moment.",
        actionLabel: "Retry",
        retryPolicy: "manual_retry",
        telemetryReason: input.reason,
      };
    case "poster_unavailable":
      return {
        title: "Preview unavailable",
        message: "The video preview could not load, but the video may still play.",
        actionLabel: "Play",
        retryPolicy: "manual_retry",
        telemetryReason: input.reason,
      };
    case "hls_auth_failed":
      return {
        title: "Video access expired",
        message: "We are refreshing the video link. Try again if playback does not resume.",
        actionLabel: "Retry",
        retryPolicy: "auto_refresh_once",
        telemetryReason: input.reason,
      };
    case "unknown":
      return {
        title: "Media unavailable",
        message: "This media could not load. Try again in a moment.",
        actionLabel: "Retry",
        retryPolicy: "manual_retry",
        telemetryReason: input.reason,
      };
  }
}
