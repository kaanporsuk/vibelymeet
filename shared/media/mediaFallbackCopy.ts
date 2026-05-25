export type MediaFallbackReason =
  | "auth_expired"
  | "asset_deleted"
  | "provider_unreachable"
  | "poster_unavailable"
  | "hls_auth_failed"
  | "unknown";

export type MediaFallbackRetryPolicy = "auto_refresh_once" | "manual_retry" | "no_retry";
export type MediaFallbackResolveErrorCode =
  | "network_error"
  | "auth_expired"
  | "asset_deleted"
  | "provider_unreachable"
  | "resolver_error"
  | "media_asset_processing_failed"
  | "media_asset_unavailable";
export type MediaFallbackFailureStage = "resolve" | "poster" | "playback" | "hls_auth";

export type MediaFallbackCopy = {
  title: string;
  message: string;
  actionLabel: string | null;
  retryPolicy: MediaFallbackRetryPolicy;
  telemetryReason: MediaFallbackReason;
};

export function resolveMediaFallbackReason(input: {
  reason?: MediaFallbackReason | null;
  errorCode?: MediaFallbackResolveErrorCode | string | null;
  httpStatus?: number | null;
  stage?: MediaFallbackFailureStage | null;
}): MediaFallbackReason {
  if (input.reason) return input.reason;
  if (input.stage === "poster") return "poster_unavailable";

  const code = typeof input.errorCode === "string" ? input.errorCode : "";
  if (code === "auth_expired") return "auth_expired";
  if (code === "asset_deleted" || code === "media_asset_processing_failed" || code === "media_asset_unavailable") {
    return "asset_deleted";
  }
  if (code === "network_error" || code === "provider_unreachable") return "provider_unreachable";

  const httpStatusReason = resolveHttpStatusFallbackReason(input.httpStatus);
  if (input.stage === "hls_auth") {
    if (httpStatusReason === "auth_expired") return "hls_auth_failed";
    return httpStatusReason ?? "hls_auth_failed";
  }
  if (httpStatusReason) return httpStatusReason;
  return "unknown";
}

function resolveHttpStatusFallbackReason(httpStatus: number | null | undefined): MediaFallbackReason | null {
  if (httpStatus === 401 || httpStatus === 403) return "auth_expired";
  if (httpStatus === 404 || httpStatus === 410) return "asset_deleted";
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return "provider_unreachable";
  return null;
}

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
