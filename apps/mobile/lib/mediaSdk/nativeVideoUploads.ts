import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  createMediaUploadPathTelemetryFields,
  createMediaClientRequestId,
  createNativeMediaSdk,
  MEDIA_UPLOAD_PATH_EVENT_NAMES,
  waitForMediaUploadTaskTerminal,
  type MediaTaskRunContext,
  type NativeMediaSdk,
  type NativeVideoUploadInput,
} from '@clientShared/media-sdk';
import { failClosedUploadEvaluation } from '@clientShared/featureFlags/clientFeatureFlagCore';
import { trackEvent } from '@/lib/analytics';
import { evaluateClientFeatureFlagForUpload, type ClientFeatureFlagEvaluation } from '@/lib/clientFeatureFlags';
import {
  nativeHeroVideoGetState,
  nativeHeroVideoReset,
  nativeHeroVideoStartWithClientRequestId,
  nativeHeroVideoSubscribe,
  type NativeHeroVideoControllerState,
} from '@/lib/nativeHeroVideoUploadController';
import { extensionFromFileUri, mimeFromExtension, type VibeVideoUploadSource } from '@/lib/vibeVideoApi';
import {
  uploadAndPublishChatVibeClipToBunnyStream,
  type ChatVibeClipStreamUploadResult,
} from '@/lib/chatVibeClipStreamUpload';
import { createNativeMediaUploadReconciler } from '@/lib/mediaSdk/reconciliation';
import { nativeMediaTelemetrySinks } from '@/lib/mediaSdk/sinks';

type NativeChatVibeClipSdkUploadParams = Parameters<typeof uploadAndPublishChatVibeClipToBunnyStream>[0];
type NativeHeroVideoUploadContext = 'onboarding' | 'profile_studio';

const chatClipResultsByClientRequestId = new Map<string, ChatVibeClipStreamUploadResult>();
const chatClipErrorsByClientRequestId = new Map<string, unknown>();
const chatClipProgressByClientRequestId = new Map<string, ((fraction: number) => void) | undefined>();
const chatClipCleanupTimersByClientRequestId = new Map<string, ReturnType<typeof setTimeout>>();
const CHAT_CLIP_TRANSIENT_STATE_TTL_MS = 60 * 60 * 1000;

let mediaSdk: NativeMediaSdk | null = null;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function trackMediaUploadStarted(params: {
  evaluation: ClientFeatureFlagEvaluation;
  path: 'media_sdk' | 'legacy';
  family: NativeVideoUploadInput['family'];
  clientRequestId: string;
}): void {
  try {
    const fields = createMediaUploadPathTelemetryFields({
      flag: 'media_v2_video',
      evaluation: params.evaluation,
      path: params.path,
      family: params.family,
      platform: nativePlatform(),
      clientRequestId: params.clientRequestId,
    });
    for (const eventName of MEDIA_UPLOAD_PATH_EVENT_NAMES) trackEvent(eventName, fields);
  } catch {
    /* upload telemetry is best-effort and must not block media uploads */
  }
}

function uploadContextFromInput(input: NativeVideoUploadInput): NativeHeroVideoUploadContext {
  const value = input.context?.uploadContext ?? 'profile_studio';
  if (value === 'onboarding' || value === 'profile_studio') return value;
  throw new Error('vibe_video_invalid_upload_context');
}

function uploadSourceFromInput(input: NativeVideoUploadInput): VibeVideoUploadSource {
  const value = input.context?.uploadSource;
  return value === 'camera' || value === 'library' || value === 'drawer' ? value : 'unknown';
}

function failSnapshotForHeroState(state: NativeHeroVideoControllerState): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (state.phase === 'stalled') {
    return {
      code: 'vibe_video_processing_stalled',
      message: state.errorMessage ?? 'Your video is taking longer than expected.',
      retryable: true,
    };
  }
  return {
    code: 'vibe_video_upload_failed',
    message: state.errorMessage ?? 'Upload failed. Please try again.',
    retryable: true,
  };
}

function shouldResetHeroVideoForTask(state: NativeHeroVideoControllerState, clientRequestId: string): boolean {
  return state.clientRequestId === clientRequestId && state.phase !== 'ready';
}

function mirrorNativeHeroVideoControllerToSdk(controls: MediaTaskRunContext): Promise<void> {
  return new Promise((resolve) => {
    const clientRequestId = controls.snapshot().clientRequestId;
    let settled = false;
    let unsubscribe: () => void = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve();
    };
    const applyState = (state: NativeHeroVideoControllerState) => {
      if (settled) return;
      if (state.clientRequestId !== clientRequestId) {
        controls.dispatch({ type: 'cancel', reason: 'vibe_video_upload_replaced' });
        finish();
        return;
      }
      if (state.phase === 'uploading') {
        controls.dispatch({ type: 'progress', progress: state.uploadProgress / 100 });
        return;
      }
      if (state.phase === 'processing') {
        controls.dispatch({ type: 'upload_complete' });
        return;
      }
      if (state.phase === 'ready') {
        controls.dispatch({
          type: 'ready',
          result: {
            providerObjectId: state.videoId,
            status: 'ready',
          },
        });
        finish();
        return;
      }
      if (state.phase === 'failed' || state.phase === 'stalled') {
        controls.dispatch({ type: 'fail', error: failSnapshotForHeroState(state) });
        finish();
        return;
      }
      if (state.phase === 'idle') {
        controls.dispatch({ type: 'cancel', reason: 'vibe_video_controller_idle' });
        finish();
      }
    };

    unsubscribe = nativeHeroVideoSubscribe(applyState);
    applyState(nativeHeroVideoGetState());
  });
}

async function uploadNativeVibeVideoViaController(
  input: NativeVideoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  controls.bindLifecycle({
    cancel: () => {
      if (shouldResetHeroVideoForTask(nativeHeroVideoGetState(), clientRequestId)) nativeHeroVideoReset();
    },
  });
  nativeHeroVideoStartWithClientRequestId(
    input.source.uri,
    optionalString(input.context?.caption),
    uploadContextFromInput(input),
    uploadSourceFromInput(input),
    clientRequestId,
  );
  await mirrorNativeHeroVideoControllerToSdk(controls);
}

function requiredContextString(input: NativeVideoUploadInput, key: string): string {
  const value = input.context?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`chat_vibe_clip_${key}_missing`);
}

function requiredContextNumber(input: NativeVideoUploadInput, key: string): number {
  const value = input.context?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`chat_vibe_clip_${key}_missing`);
}

function clearChatClipTransientState(clientRequestId: string): void {
  const timer = chatClipCleanupTimersByClientRequestId.get(clientRequestId);
  if (timer) clearTimeout(timer);
  chatClipCleanupTimersByClientRequestId.delete(clientRequestId);
  chatClipProgressByClientRequestId.delete(clientRequestId);
  chatClipResultsByClientRequestId.delete(clientRequestId);
  chatClipErrorsByClientRequestId.delete(clientRequestId);
}

function scheduleChatClipTransientStateCleanup(clientRequestId: string): void {
  const existing = chatClipCleanupTimersByClientRequestId.get(clientRequestId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    clearChatClipTransientState(clientRequestId);
  }, CHAT_CLIP_TRANSIENT_STATE_TTL_MS);
  chatClipCleanupTimersByClientRequestId.set(clientRequestId, timer);
}

async function uploadNativeChatVibeClipViaLegacyService(
  input: NativeVideoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const onProgress = chatClipProgressByClientRequestId.get(clientRequestId);
  try {
    const uploaded = await uploadAndPublishChatVibeClipToBunnyStream({
      matchId: requiredContextString(input, 'matchId'),
      clientRequestId,
      uri: input.source.uri,
      durationMs: requiredContextNumber(input, 'durationMs'),
      mimeType: input.source.mimeType ?? optionalString(input.context?.mimeType) ?? null,
      aspectRatio: typeof input.context?.aspectRatio === 'number' ? input.context.aspectRatio : null,
      captions: input.context?.captions,
      resumeStrategy: input.context?.resumeStrategy === 'reissue_credentials' ? 'reissue_credentials' : undefined,
      signal: (input.options?.signal as AbortSignal | null | undefined) ?? undefined,
      onProgress: (fraction) => {
        controls.dispatch({ type: 'progress', progress: fraction });
        onProgress?.(fraction);
        scheduleChatClipTransientStateCleanup(clientRequestId);
      },
    });
    chatClipResultsByClientRequestId.set(clientRequestId, uploaded);
    scheduleChatClipTransientStateCleanup(clientRequestId);
    controls.dispatch({
      type: 'ready',
      result: {
        assetId: uploaded.uploadId,
        providerObjectId: uploaded.videoId,
        mediaRef: uploaded.playbackRef,
        status: uploaded.status,
      },
    });
  } catch (error) {
    chatClipErrorsByClientRequestId.set(clientRequestId, error);
    scheduleChatClipTransientStateCleanup(clientRequestId);
    throw error;
  }
}

function nativePlatform() {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'native';
}

function getNativeVideoMediaSdk(): NativeMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createNativeMediaSdk({
      asyncStorage: AsyncStorage,
      fileSystem: FileSystem,
      platform: nativePlatform(),
      telemetrySinks: nativeMediaTelemetrySinks,
      reconciler: createNativeMediaUploadReconciler(),
      delegates: {
        video: {
          uploadVibeVideo: uploadNativeVibeVideoViaController,
          uploadChatVibeClip: uploadNativeChatVibeClipViaLegacyService,
        },
      },
    });
  }
  return mediaSdk;
}

export async function reconcileNativeVideoMediaSdkQueue(reason = 'manual'): Promise<void> {
  await getNativeVideoMediaSdk().reconcile({ reason });
}

export function startNativeVibeVideoUpload(params: {
  uri: string;
  caption?: string;
  context?: NativeHeroVideoUploadContext;
  uploadSource?: VibeVideoUploadSource;
}): void {
  const context = params.context ?? 'profile_studio';
  const clientRequestId = createMediaClientRequestId();
  void startNativeVibeVideoUploadAfterGate(params, context, clientRequestId);
}

async function startNativeVibeVideoUploadAfterGate(
  params: {
    uri: string;
    caption?: string;
    context?: NativeHeroVideoUploadContext;
    uploadSource?: VibeVideoUploadSource;
  },
  context: NativeHeroVideoUploadContext,
  clientRequestId: string,
): Promise<void> {
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload('media_v2_video');
  } catch {
    evaluation = failClosedUploadEvaluation('media_v2_video');
  }
  const path = evaluation.enabled ? 'media_sdk' : 'legacy';
  trackMediaUploadStarted({
    evaluation,
    path,
    family: 'vibe_video',
    clientRequestId,
  });

  if (!evaluation.enabled) {
    nativeHeroVideoStartWithClientRequestId(
      params.uri,
      params.caption,
      context,
      params.uploadSource,
      clientRequestId,
    );
    return;
  }
  getNativeVideoMediaSdk().video.upload({
    family: 'vibe_video',
    source: {
      uri: params.uri,
      mimeType: mimeFromExtension(extensionFromFileUri(params.uri)),
    },
    context: {
      uploadContext: context,
      caption: params.caption,
      uploadSource: params.uploadSource ?? 'unknown',
    },
    options: {
      clientRequestId,
    },
  });
}

export async function uploadAndPublishChatVibeClipWithMediaSdk(
  params: NativeChatVibeClipSdkUploadParams,
): Promise<ChatVibeClipStreamUploadResult> {
  const clientRequestId = params.clientRequestId ?? createMediaClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload('media_v2_video');
  } catch {
    evaluation = failClosedUploadEvaluation('media_v2_video');
  }
  const path = evaluation.enabled ? 'media_sdk' : 'legacy';
  trackMediaUploadStarted({
    evaluation,
    path,
    family: 'chat_vibe_clip',
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadAndPublishChatVibeClipToBunnyStream({ ...params, clientRequestId });
  }

  const task = getNativeVideoMediaSdk().video.upload({
    family: 'chat_vibe_clip',
    source: {
      uri: params.uri,
      mimeType: params.mimeType ?? null,
    },
    context: {
      uploadContext: 'chat',
      scopeKey: params.matchId,
      matchId: params.matchId,
      durationMs: params.durationMs,
      mimeType: params.mimeType ?? null,
      aspectRatio: params.aspectRatio ?? null,
      captions: params.captions,
      resumeStrategy: params.resumeStrategy ?? null,
    },
    options: {
      clientRequestId,
      signal: params.signal ?? null,
    },
  });
  chatClipProgressByClientRequestId.set(clientRequestId, params.onProgress);
  scheduleChatClipTransientStateCleanup(clientRequestId);

  try {
    const terminal = await waitForMediaUploadTaskTerminal(task);
    const originalError = chatClipErrorsByClientRequestId.get(clientRequestId);
    if (originalError) throw originalError;

    const uploaded = chatClipResultsByClientRequestId.get(clientRequestId);
    if (uploaded) return uploaded;

    if (terminal.state === 'failed') {
      throw new Error(terminal.error?.message ?? 'Could not publish Vibe Clip.');
    }
    throw new Error('Vibe Clip upload completed without a publish result.');
  } finally {
    clearChatClipTransientState(clientRequestId);
  }
}
