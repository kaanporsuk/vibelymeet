import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";

export const VIBE_VIDEO_EVENTS = {
  credentialsRequestStarted: "vibe_video_credentials_request_started",
  credentialsRequestSucceeded: "vibe_video_credentials_request_succeeded",
  credentialsRequestFailed: "vibe_video_credentials_request_failed",
  tusUploadStarted: "vibe_video_tus_upload_started",
  tusUploadSucceeded: "vibe_video_tus_upload_succeeded",
  tusUploadFailed: "vibe_video_tus_upload_failed",
  uploadStalled: "vibe_video_upload_stalled",
  processingPollStarted: "vibe_video_processing_poll_started",
  pollStalledVisible: "vibe_video_poll_stalled_visible",
  visibilityResumePoll: "vibe_video_visibility_resume_poll",
  processingStatusChanged: "vibe_video_processing_status_changed",
  staleProcessingObserved: "vibe_video_stale_processing_observed",
  processingStalled: "vibe_video_processing_stalled",
  readyObserved: "vibe_video_ready_observed",
  failedObserved: "vibe_video_failed_observed",
  playbackAttempted: "vibe_video_playback_attempted",
  playbackSucceeded: "vibe_video_playback_succeeded",
  playbackFailed: "vibe_video_playback_failed",
  cdnHostnameFallbackUsed: "vibe_video_cdn_hostname_fallback_used",
  deleteRequested: "vibe_video_delete_requested",
  deleteSucceededLocally: "vibe_video_delete_succeeded_locally",
  replaceStarted: "vibe_video_replace_started",
  captionPreserved: "vibe_video_caption_preserved",
  captionEdited: "vibe_video_caption_edited",
  captionCleared: "vibe_video_caption_cleared",
  captionToggleChanged: "caption_toggle_changed",
  profileReportSubmitted: "vibe_video_profile_report_submitted",
} as const;

export type VibeVideoEventName = (typeof VIBE_VIDEO_EVENTS)[keyof typeof VIBE_VIDEO_EVENTS];

type SafeTelemetryValue = string | number | boolean | null | undefined;
export type VibeVideoTelemetryProperties = Record<string, SafeTelemetryValue>;

const staleProcessingSeen = new Set<string>();

const SENSITIVE_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|url|uri|path|(?:^|_)(?:file|filename)(?:$|_)|headers?)/i;

function sanitizeProperties(
  properties: VibeVideoTelemetryProperties = {},
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = { platform: "web" };

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }

  return out;
}

export function trackVibeVideoEvent(
  eventName: VibeVideoEventName,
  properties: VibeVideoTelemetryProperties = {},
): void {
  const sanitized = sanitizeProperties(properties);
  try {
    trackEvent(eventName, sanitized);
  } catch {
    // Telemetry is diagnostic only; never let analytics availability break Vibe Video state.
  }
  try {
    Sentry.addBreadcrumb({
      category: "vibe-video",
      message: eventName,
      level: "info",
      data: sanitized,
    });
  } catch {
    // Breadcrumb capture is also best-effort.
  }
}

export function trackStaleVibeVideoProcessing(
  properties: VibeVideoTelemetryProperties = {},
): void {
  const userId = String(properties.user_id ?? properties.userId ?? "unknown");
  const videoGuid = String(properties.video_guid ?? "unknown");
  const surface = String(properties.surface ?? properties.source ?? "unknown");
  const key = `${userId}:${videoGuid}:${surface}`;
  if (staleProcessingSeen.has(key)) return;
  staleProcessingSeen.add(key);
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.staleProcessingObserved, properties);
}

export function addVibeVideoBreadcrumb(
  message: string,
  properties: VibeVideoTelemetryProperties = {},
  level: Sentry.SeverityLevel = "info",
): void {
  Sentry.addBreadcrumb({
    category: "vibe-video",
    message,
    level,
    data: sanitizeProperties(properties),
  });
}

export function captureVibeVideoException(
  error: unknown,
  properties: VibeVideoTelemetryProperties = {},
): void {
  Sentry.captureException(error, {
    tags: { feature: "vibe_video" },
    extra: sanitizeProperties(properties),
  });
}
