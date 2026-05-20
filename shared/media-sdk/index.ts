export type {
  MediaPhotoFamily,
  MediaPhotoUploadInput,
  MediaSdk,
  MediaUploadContext,
  MediaUploadErrorInfo,
  MediaUploadFamily,
  MediaUploadInput,
  MediaUploadOptions,
  MediaUploadPlatform,
  MediaUploadResult,
  MediaUploadSnapshot,
  MediaUploadState,
  MediaUploadTask,
  MediaUploadTaskEvent,
  MediaUploadTaskListener,
  MediaVideoFamily,
  MediaVideoUploadInput,
  MediaVoiceFamily,
  MediaVoiceUploadInput,
} from "./core/types";
export {
  MEDIA_UPLOAD_STATES,
  clampUploadProgress,
  createInitialMediaUploadSnapshot,
  isMediaUploadTerminalState,
  transitionMediaUploadState,
} from "./core/state-machine";
export type { MediaUploadTransition } from "./core/state-machine";
export {
  DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS,
  reconcileMediaUploadQueue,
} from "./core/reconcile";
export { createMediaClientRequestId } from "./core/client-request-id";
export {
  clearMediaSdkForegroundReconcileForTests,
  markMediaSdkForegroundReconcile,
  MEDIA_SDK_FOREGROUND_RECONCILE_MIN_MS,
  shouldRunMediaSdkForegroundReconcile,
} from "./core/reconcile-foreground";
export type {
  MediaUploadQueueReconciler,
  MediaUploadReconcileResult,
  MediaUploadServerRecord,
  MediaUploadServerState,
} from "./core/reconcile";
export { MemoryMediaUploadQueue } from "./core/queue";
export {
  assertMediaUploadQueueSourceBinding,
  matchesMediaUploadQueueFilter,
  MediaUploadQueueSourceConflictError,
} from "./core/queue";
export type { MediaUploadQueue, MediaUploadQueueFilter, MediaUploadQueueRecord } from "./core/queue";
export { createMediaTelemetry, noopMediaTelemetry } from "./core/telemetry";
export { safeTelemetryFields } from "./core/telemetry";
export type { MediaTelemetry, MediaTelemetryEvent, MediaTelemetryFields, MediaTelemetrySink } from "./core/telemetry";
export {
  createMediaUploadPathTelemetryFields,
  MEDIA_UPLOAD_PATH_EVENT_NAMES,
  mediaUploadRuntimePath,
} from "./core/facade-telemetry";
export type {
  MediaUploadFeatureFlag,
  MediaUploadPathEvaluation,
  MediaUploadPathEventName,
  MediaUploadPathSelected,
  MediaUploadRuntimePath,
} from "./core/facade-telemetry";
export { createMediaUploadTask, waitForMediaUploadTaskTerminal } from "./core/task";
export type { MediaTaskLifecycleControls, MediaTaskRunContext, MediaTaskRunner } from "./core/task";
export {
  getMediaBackgroundUploadPolicy,
  mediaBackgroundUploadPolicyReviewWarning,
  mediaBackgroundUploadPolicyTelemetryFields,
  MEDIA_BACKGROUND_UPLOAD_CANDIDATES,
  MEDIA_BACKGROUND_UPLOAD_DECIDED_AT,
  MEDIA_BACKGROUND_UPLOAD_PHASE,
  MEDIA_BACKGROUND_UPLOAD_POLICY,
  MEDIA_BACKGROUND_UPLOAD_PRODUCTION_ENABLED,
  MEDIA_BACKGROUND_UPLOAD_REVIEW_AFTER,
  MEDIA_BACKGROUND_UPLOAD_SOURCE_OF_TRUTH,
  shouldEnableOsBackgroundUploads,
} from "./background-upload-policy";
export type {
  MediaBackgroundUploadDecision,
  MediaBackgroundUploadCandidate,
  MediaBackgroundUploadPlatform,
  MediaBackgroundUploadPlatformGate,
  MediaBackgroundUploadPolicy,
} from "./background-upload-policy";
export {
  assertWebMediaSource,
  createIndexedDbMediaUploadQueue,
  createWebMediaSdk,
  IndexedDbMediaUploadQueue,
  webMediaTranscode,
} from "./adapters/web";
export type {
  WebLegacyMediaDelegates,
  WebMediaSdk,
  WebMediaSdkOptions,
  WebMediaSource,
  WebMediaUploadDelegate,
  WebMediaUploadInput,
  WebPhotoTranscoder,
  WebPhotoUploadInput,
  WebVideoUploadInput,
  WebVoiceRecorderConfig,
  WebVoiceUploadInput,
} from "./adapters/web";
export {
  assertNativeUriSource,
  createNativeMediaSdk,
  nativeMediaTranscodeHooks,
  NativeAsyncStorageMediaUploadQueue,
} from "./adapters/native";
export type {
  NativeAsyncStorageLike,
  NativeAudioHooks,
  NativeFileSystemLike,
  NativeImageManipulatorLike,
  NativeLegacyMediaDelegates,
  NativeLocalUriSource,
  NativeMediaSdk,
  NativeMediaSdkOptions,
  NativeMediaUploadDelegate,
  NativeMediaUploadInput,
  NativePhotoTranscoder,
  NativePhotoUploadInput,
  NativeVideoUploadInput,
  NativeVoiceUploadInput,
} from "./adapters/native";
