import * as Sentry from '@sentry/react-native';
import {
  sanitizeMediaTelemetryProperties,
  type MediaTelemetryProperties,
} from '@clientShared/media/telemetry';
import { trackEvent } from '@/lib/analytics';

export const VIBE_VIDEO_EVENTS = {
  credentialsRequestStarted: 'vibe_video_credentials_request_started',
  credentialsRequestSucceeded: 'vibe_video_credentials_request_succeeded',
  credentialsRequestFailed: 'vibe_video_credentials_request_failed',
  tusUploadStarted: 'vibe_video_tus_upload_started',
  tusUploadSucceeded: 'vibe_video_tus_upload_succeeded',
  tusUploadFailed: 'vibe_video_tus_upload_failed',
  uploadStalled: 'vibe_video_upload_stalled',
  appStateResumePoll: 'vibe_video_app_state_resume_poll',
  processingPollStarted: 'vibe_video_processing_poll_started',
  processingStatusChanged: 'vibe_video_processing_status_changed',
  staleProcessingObserved: 'vibe_video_stale_processing_observed',
  processingStalled: 'vibe_video_processing_stalled',
  readyObserved: 'vibe_video_ready_observed',
  failedObserved: 'vibe_video_failed_observed',
  playbackAttempted: 'vibe_video_playback_attempted',
  playbackSucceeded: 'vibe_video_playback_succeeded',
  playbackFailed: 'vibe_video_playback_failed',
  tokenRefreshOnAuthError: 'media_token_refresh_on_hls_error',
  cdnHostnameFallbackUsed: 'vibe_video_cdn_hostname_fallback_used',
  cdnHostnamePersistenceMismatch: 'vibe_video_cdn_hostname_persistence_mismatch',
  deleteRequested: 'vibe_video_delete_requested',
  deleteSucceededLocally: 'vibe_video_delete_succeeded_locally',
  replaceStarted: 'vibe_video_replace_started',
  captionPreserved: 'vibe_video_caption_preserved',
  captionEdited: 'vibe_video_caption_edited',
  captionCleared: 'vibe_video_caption_cleared',
  profileReportSubmitted: 'vibe_video_profile_report_submitted',
} as const;

export type VibeVideoEventName = (typeof VIBE_VIDEO_EVENTS)[keyof typeof VIBE_VIDEO_EVENTS];

export type VibeVideoTelemetryProperties = MediaTelemetryProperties;

const staleProcessingSeen = new Set<string>();

function sanitizeProperties(
  properties: VibeVideoTelemetryProperties = {},
): Record<string, string | number | boolean | null> {
  return sanitizeMediaTelemetryProperties(properties, { defaults: { platform: 'native' } });
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
      category: 'vibe-video',
      message: eventName,
      level: 'info',
      data: sanitized,
    });
  } catch {
    // Breadcrumb capture is also best-effort.
  }
}

export function trackStaleVibeVideoProcessing(
  properties: VibeVideoTelemetryProperties = {},
): void {
  const userId = String(properties.user_id ?? properties.userId ?? 'unknown');
  const videoGuid = String(properties.video_guid ?? 'unknown');
  const surface = String(properties.surface ?? properties.source ?? 'unknown');
  const key = `${userId}:${videoGuid}:${surface}`;
  if (staleProcessingSeen.has(key)) return;
  staleProcessingSeen.add(key);
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.staleProcessingObserved, properties);
}

export function addVibeVideoBreadcrumb(
  message: string,
  properties: VibeVideoTelemetryProperties = {},
  level: Sentry.SeverityLevel = 'info',
): void {
  Sentry.addBreadcrumb({
    category: 'vibe-video',
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
    tags: { feature: 'vibe_video' },
    extra: sanitizeProperties(properties),
  });
}
