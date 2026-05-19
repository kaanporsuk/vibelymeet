import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  createNativeMediaSdk,
  createStaticMediaFeatureFlagGate,
  isMediaUploadTerminalState,
  type MediaTaskRunContext,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type NativeMediaSdk,
  type NativeVideoUploadInput,
} from '@clientShared/media-sdk';
import {
  nativeHeroVideoGetState,
  nativeHeroVideoReset,
  nativeHeroVideoStart,
  nativeHeroVideoStartWithClientRequestId,
  nativeHeroVideoSubscribe,
  type NativeHeroVideoControllerState,
} from '@/lib/nativeHeroVideoUploadController';
import type { VibeVideoUploadSource } from '@/lib/vibeVideoApi';
import {
  uploadAndPublishChatVibeClipToBunnyStream,
  type ChatVibeClipStreamUploadResult,
} from '@/lib/chatVibeClipStreamUpload';

type NativeChatVibeClipSdkUploadParams = Parameters<typeof uploadAndPublishChatVibeClipToBunnyStream>[0];
type NativeHeroVideoUploadContext = 'onboarding' | 'profile_studio';

const mediaV2VideoGate = createStaticMediaFeatureFlagGate({ media_v2_video: true });
const chatClipResultsByClientRequestId = new Map<string, ChatVibeClipStreamUploadResult>();
const chatClipErrorsByClientRequestId = new Map<string, unknown>();
const chatClipProgressByClientRequestId = new Map<string, ((fraction: number) => void) | undefined>();

let mediaSdk: NativeMediaSdk | null = null;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function uploadContextFromInput(input: NativeVideoUploadInput): NativeHeroVideoUploadContext {
  return input.context?.uploadContext === 'onboarding' ? 'onboarding' : 'profile_studio';
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
      onProgress: (fraction) => {
        controls.dispatch({ type: 'progress', progress: fraction });
        onProgress?.(fraction);
      },
    });
    chatClipResultsByClientRequestId.set(clientRequestId, uploaded);
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
      flagGate: mediaV2VideoGate,
      platform: nativePlatform(),
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

function waitForTaskTerminal(task: MediaUploadTask): Promise<MediaUploadSnapshot> {
  const current = task.snapshot();
  if (isMediaUploadTerminalState(current.state)) return Promise.resolve(current);
  return new Promise((resolve) => {
    const unsubscribe = task.on('state', (snapshot) => {
      if (!isMediaUploadTerminalState(snapshot.state)) return;
      unsubscribe();
      resolve(snapshot);
    });
  });
}

export function startNativeVibeVideoUpload(params: {
  uri: string;
  caption?: string;
  context?: NativeHeroVideoUploadContext;
  uploadSource?: VibeVideoUploadSource;
  mediaV2VideoEnabled: boolean;
}): void {
  const context = params.context ?? 'profile_studio';
  if (!params.mediaV2VideoEnabled) {
    nativeHeroVideoStart(params.uri, params.caption, context, params.uploadSource);
    return;
  }

  getNativeVideoMediaSdk().video.upload({
    family: 'vibe_video',
    source: {
      uri: params.uri,
      mimeType: 'video/mp4',
    },
    context: {
      uploadContext: context,
      caption: params.caption,
      uploadSource: params.uploadSource ?? 'unknown',
    },
  });
}

export async function uploadAndPublishChatVibeClipWithMediaSdk(
  params: NativeChatVibeClipSdkUploadParams,
): Promise<ChatVibeClipStreamUploadResult> {
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
    },
    options: {
      clientRequestId: params.clientRequestId,
    },
  });
  const clientRequestId = task.clientRequestId;
  chatClipProgressByClientRequestId.set(clientRequestId, params.onProgress);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = chatClipErrorsByClientRequestId.get(clientRequestId);
    if (originalError) throw originalError;

    const uploaded = chatClipResultsByClientRequestId.get(clientRequestId);
    if (uploaded) return uploaded;

    if (terminal.state === 'failed') {
      throw new Error(terminal.error?.message ?? 'Could not publish Vibe Clip.');
    }
    throw new Error('Vibe Clip upload completed without a publish result.');
  } finally {
    chatClipProgressByClientRequestId.delete(clientRequestId);
    chatClipResultsByClientRequestId.delete(clientRequestId);
    chatClipErrorsByClientRequestId.delete(clientRequestId);
  }
}
