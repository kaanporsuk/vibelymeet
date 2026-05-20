import type { MediaTelemetryFields } from "./telemetry";
import type { MediaUploadFamily, MediaUploadPlatform } from "./types";

export const MEDIA_UPLOAD_PATH_EVENT_NAMES = [
  "media_upload_started",
  "media_upload_path_taken",
  "media_upload_sdk_flag_evaluated",
] as const;

export type MediaUploadPathEventName = (typeof MEDIA_UPLOAD_PATH_EVENT_NAMES)[number];
export type MediaUploadPathSelected = "media_sdk" | "legacy";
export type MediaUploadRuntimePath = "v2" | "legacy";
export type MediaUploadFeatureFlag = "media_v2_video" | "media_v2_photo" | "media_v2_voice";

export type MediaUploadPathEvaluation = {
  enabled: boolean;
  source: string;
  bucket: number | null;
  rolloutBps: number | null;
  userIdBucket: string | null;
};

export function mediaUploadRuntimePath(path: MediaUploadPathSelected): MediaUploadRuntimePath {
  return path === "media_sdk" ? "v2" : "legacy";
}

export function createMediaUploadPathTelemetryFields(params: {
  flag: MediaUploadFeatureFlag;
  evaluation: MediaUploadPathEvaluation;
  path: MediaUploadPathSelected;
  family: MediaUploadFamily;
  platform: MediaUploadPlatform;
  clientRequestId: string;
}): MediaTelemetryFields {
  return {
    active_flag: params.flag,
    active_flag_enabled: params.evaluation.enabled,
    active_flag_source: params.evaluation.source,
    active_flag_bucket: params.evaluation.bucket,
    active_flag_rollout_bps: params.evaluation.rolloutBps,
    user_id_bucket: params.evaluation.userIdBucket,
    path: mediaUploadRuntimePath(params.path),
    path_selected: params.path,
    family: params.family,
    platform: params.platform,
    client_request_id: params.clientRequestId,
  };
}
