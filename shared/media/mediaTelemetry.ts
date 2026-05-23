import { MEDIA_UPLOAD_PATH_EVENT_NAMES } from "../media-sdk/core/facade-telemetry";
import {
  sanitizeMediaTelemetryProperties,
  type MediaTelemetryProperties,
  type MediaTelemetrySanitizeOptions,
} from "./telemetry";

export const MEDIA_VIBE_VIDEO_EVENTS = {
  credentialsRequestStarted: "vibe_video_credentials_request_started",
  credentialsRequestSucceeded: "vibe_video_credentials_request_succeeded",
  credentialsRequestFailed: "vibe_video_credentials_request_failed",
  tusUploadStarted: "vibe_video_tus_upload_started",
  tusUploadSucceeded: "vibe_video_tus_upload_succeeded",
  tusUploadFailed: "vibe_video_tus_upload_failed",
  uploadStalled: "vibe_video_upload_stalled",
  appStateResumePoll: "vibe_video_app_state_resume_poll",
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
  profileTtffMeasured: "vibe_video_profile_ttff_ms",
  tokenRefreshOnAuthError: "media_token_refresh_on_hls_error",
  cdnHostnameFallbackUsed: "vibe_video_cdn_hostname_fallback_used",
  cdnHostnamePersistenceMismatch: "vibe_video_cdn_hostname_persistence_mismatch",
  deleteRequested: "vibe_video_delete_requested",
  deleteSucceededLocally: "vibe_video_delete_succeeded_locally",
  replaceStarted: "vibe_video_replace_started",
  captionPreserved: "vibe_video_caption_preserved",
  captionEdited: "vibe_video_caption_edited",
  captionCleared: "vibe_video_caption_cleared",
  captionToggleChanged: "caption_toggle_changed",
  profileReportSubmitted: "vibe_video_profile_report_submitted",
} as const;

export const MEDIA_PLAYBACK_QOE_EVENTS = {
  summary: "media_playback_qoe",
  rebuffer: "media_playback_qoe_rebuffer",
} as const;

export const MEDIA_VIBE_CLIP_EVENTS = {
  clip_entry_opened: "clip_entry_opened",
  clip_record_started: "clip_record_started",
  clip_record_completed: "clip_record_completed",
  clip_retake: "clip_retake",
  clip_send_attempted: "clip_send_attempted",
  clip_send_succeeded: "clip_send_succeeded",
  clip_send_failed: "clip_send_failed",
  clip_play_started: "clip_play_started",
  clip_play_completed: "clip_play_completed",
  clip_reply_with_clip_clicked: "clip_reply_with_clip_clicked",
  clip_voice_reply_clicked: "clip_voice_reply_clicked",
  clip_react_clicked: "clip_react_clicked",
  clip_date_cta_clicked: "clip_date_cta_clicked",
  clip_date_flow_opened: "clip_date_flow_opened",
  clip_date_submitted_from_clip: "clip_date_submitted_from_clip",
  clip_recovery_status: "clip_recovery_status",
  media_upload_suspended_recovery: "media_upload_suspended_recovery",
  caption_capture_unavailable: "caption_capture_unavailable",
  caption_capture_started: "caption_capture_started",
  caption_capture_succeeded: "caption_capture_succeeded",
  caption_capture_aborted: "caption_capture_aborted",
  caption_capture_failed: "caption_capture_failed",
  caption_toggle_changed: "caption_toggle_changed",
} as const;

export const MEDIA_EDGE_TELEMETRY_EVENTS = {
  receiptTransition: "media_upload_receipt_transition",
  providerUnreachable: "media_provider_unreachable",
  bunnyCdnHealth: "bunny_cdn_health",
  archiveFailed: "media_archive_failed",
  archiveHotDeleteFailed: "media_archive_hot_delete_failed",
  archivedToColdStorage: "media_archived_to_cold_storage",
  uploadedOrphanDeleteEnqueued: "media_uploaded_orphan_delete_enqueued",
  profileVibeVideoTokenConfigMissing: "profile_vibe_video_token_config_missing",
  profileVibeVideoSignedUrlIssued: "profile_vibe_video_signed_url_issued",
} as const;

export const MEDIA_TELEMETRY_EVENTS = {
  ...MEDIA_VIBE_VIDEO_EVENTS,
  ...MEDIA_VIBE_CLIP_EVENTS,
  ...MEDIA_PLAYBACK_QOE_EVENTS,
  ...MEDIA_EDGE_TELEMETRY_EVENTS,
  mediaUploadStarted: MEDIA_UPLOAD_PATH_EVENT_NAMES[0],
  mediaUploadPathTaken: MEDIA_UPLOAD_PATH_EVENT_NAMES[1],
  mediaUploadSdkFlagEvaluated: MEDIA_UPLOAD_PATH_EVENT_NAMES[2],
} as const;

export type MediaVibeVideoEventName = (typeof MEDIA_VIBE_VIDEO_EVENTS)[keyof typeof MEDIA_VIBE_VIDEO_EVENTS];
export type MediaVibeClipEventName = (typeof MEDIA_VIBE_CLIP_EVENTS)[keyof typeof MEDIA_VIBE_CLIP_EVENTS];
export type MediaPlaybackQoeEventName = (typeof MEDIA_PLAYBACK_QOE_EVENTS)[keyof typeof MEDIA_PLAYBACK_QOE_EVENTS];
export type MediaTelemetryEventName = (typeof MEDIA_TELEMETRY_EVENTS)[keyof typeof MEDIA_TELEMETRY_EVENTS];

export const MEDIA_SDK_UPLOAD_PATH_TELEMETRY_KEYS = ["path", "path_selected"] as const;
const MEDIA_SDK_SAFE_RUNTIME_PATHS = new Set(["v2", "legacy"]);
const MEDIA_SDK_SAFE_PATH_SELECTIONS = new Set(["media_sdk", "legacy"]);

export type MediaTelemetrySanitizedProperties = Record<string, string | number | boolean | null>;

export type MediaTelemetryEventSanitizeOptions = MediaTelemetrySanitizeOptions & {
  allowUploadPathKeys?: boolean;
};

export function sanitizeMediaEventProperties(
  properties: MediaTelemetryProperties = {},
  options: MediaTelemetryEventSanitizeOptions = {},
): MediaTelemetrySanitizedProperties {
  const allowSensitiveKeys = [
    ...(options.allowSensitiveKeys ?? []),
    ...(options.allowUploadPathKeys ? MEDIA_SDK_UPLOAD_PATH_TELEMETRY_KEYS : []),
  ];
  return sanitizeMediaTelemetryProperties(properties, {
    defaults: options.defaults,
    allowSensitiveKeys,
  });
}

export function sanitizeMediaSdkTelemetryProperties(
  properties: MediaTelemetryProperties = {},
  options: MediaTelemetrySanitizeOptions = {},
): MediaTelemetrySanitizedProperties {
  const sanitized = sanitizeMediaEventProperties(properties, {
    ...options,
    allowUploadPathKeys: true,
  });
  if (typeof sanitized.path !== "string" || !MEDIA_SDK_SAFE_RUNTIME_PATHS.has(sanitized.path)) {
    delete sanitized.path;
  }
  if (
    typeof sanitized.path_selected !== "string" ||
    !MEDIA_SDK_SAFE_PATH_SELECTIONS.has(sanitized.path_selected)
  ) {
    delete sanitized.path_selected;
  }
  return sanitized;
}
