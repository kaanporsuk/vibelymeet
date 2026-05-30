export type MediaFallbackReason =
  | "auth_expired"
  | "asset_deleted"
  | "processing_failed"
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

function finiteStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function statusFromValue(value: unknown, seen: WeakSet<object>): number | null {
  return finiteStatus(value) ?? extractNativeMediaPlaybackHttpStatusValue(value, seen);
}

function recordValue(input: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined;
}

function extractHttpStatusFromObject(error: Record<string, unknown>, seen: WeakSet<object>): number | null {
  const direct =
    statusFromValue(recordValue(error, "httpStatus"), seen) ??
    statusFromValue(recordValue(error, "statusCode"), seen) ??
    statusFromValue(recordValue(error, "status"), seen);
  if (direct != null) return direct;

  const nestedCandidates = [
    recordValue(error, "message"),
    recordValue(error, "error"),
    recordValue(error, "nativeError"),
    recordValue(error, "description"),
    recordValue(error, "cause"),
    recordValue(error, "networkDetails"),
  ];
  for (const candidate of nestedCandidates) {
    const status = extractNativeMediaPlaybackHttpStatusValue(candidate, seen);
    if (status != null) return status;
  }
  return null;
}

function extractNativeMediaPlaybackHttpStatusValue(error: unknown, seen: WeakSet<object>): number | null {
  const direct = finiteStatus(error);
  if (direct != null) return direct;

  if (typeof error === "string") {
    const match = error.match(/(?:^|[^\d])(?:http\s*)?(401|403|404|410|429|500|502|503|504)(?:[^\d]|$)/i);
    return match ? Number(match[1]) : null;
  }

  if (typeof error !== "object" || error === null) return null;
  if (seen.has(error)) return null;
  seen.add(error);
  return extractHttpStatusFromObject(error as Record<string, unknown>, seen);
}

export function extractNativeMediaPlaybackHttpStatus(error: unknown): number | null {
  return extractNativeMediaPlaybackHttpStatusValue(error, new WeakSet<object>());
}

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
  // Processing failure is recoverable (retry/resend) — must NOT read as permanent deletion.
  if (code === "media_asset_processing_failed") return "processing_failed";
  if (code === "asset_deleted") return "asset_deleted";
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
  if (httpStatus === 429 || httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return "provider_unreachable";
  }
  return null;
}

export function resolveNativeMediaPlaybackFallbackReason(input: {
  uri?: string | null;
  error?: unknown;
  httpStatus?: number | null;
  isSignedSource?: boolean | null;
}): MediaFallbackReason {
  const uri = typeof input.uri === "string" ? input.uri : "";
  const isHls = /\.m3u8(?:[?#]|$)/i.test(uri);
  const httpStatus = finiteStatus(input.httpStatus) ?? extractNativeMediaPlaybackHttpStatus(input.error);
  const statusReason = resolveHttpStatusFallbackReason(httpStatus);

  if (statusReason === "auth_expired" && (input.isSignedSource || isHls)) return "hls_auth_failed";
  if (statusReason) return statusReason;
  if (input.isSignedSource || isHls) return "hls_auth_failed";
  return "unknown";
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
    case "processing_failed":
      return {
        title: "Processing didn't finish",
        message: "This media couldn't finish processing. Try sending it again.",
        actionLabel: "Retry",
        retryPolicy: "manual_retry",
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
