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
export { MemoryMediaUploadQueue } from "./core/queue";
export {
  assertMediaUploadQueueSourceBinding,
  matchesMediaUploadQueueFilter,
  MediaUploadQueueSourceConflictError,
} from "./core/queue";
export type { MediaUploadQueue, MediaUploadQueueFilter, MediaUploadQueueRecord } from "./core/queue";
export { createMediaTelemetry, noopMediaTelemetry } from "./core/telemetry";
export type { MediaTelemetry, MediaTelemetryEvent, MediaTelemetryFields, MediaTelemetrySink } from "./core/telemetry";
export {
  createStaticMediaFeatureFlagGate,
  defaultOffMediaFeatureFlagGate,
  mediaFlagForFamily,
} from "./core/flag-gate";
export type { MediaFeatureFlagGate, MediaV2FlagKey } from "./core/flag-gate";
export { createMediaUploadTask } from "./core/task";
export type { MediaTaskLifecycleControls, MediaTaskRunContext, MediaTaskRunner } from "./core/task";
export {
  assertWebMediaSource,
  createIndexedDbMediaUploadQueue,
  createWebMediaSdk,
  IndexedDbMediaUploadQueue,
  webMediaTranscode,
  webMediaTranscodeStubs,
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
