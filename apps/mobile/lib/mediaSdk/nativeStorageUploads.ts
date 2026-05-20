import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import {
  createNativeMediaSdk,
  isMediaUploadTerminalState,
  type MediaTaskRunContext,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type NativeLocalUriSource,
  type NativeMediaSdk,
  type NativePhotoUploadInput,
  type NativeVoiceUploadInput,
} from '@clientShared/media-sdk';
import { trackEvent } from '@/lib/analytics';
import { evaluateClientFeatureFlagForUpload, type ClientFeatureFlagEvaluation } from '@/lib/clientFeatureFlags';
import { uploadChatImageMessage, uploadVoiceMessage } from '@/lib/chatMediaUpload';
import { uploadProfilePhoto, type UploadImageResult } from '@/lib/uploadImage';
import { createNativeMediaUploadReconciler } from '@/lib/mediaSdk/reconciliation';
import { nativeMediaTelemetrySinks } from '@/lib/mediaSdk/sinks';

type NativeProfilePhotoSdkUploadParams = {
  asset: NativeLocalUriSource & { fileName?: string | null };
  context?: 'onboarding' | 'profile_studio';
  clientRequestId?: string;
  signal?: AbortSignal;
};

type NativeChatImageSdkUploadParams = {
  uri: string;
  mimeType?: string | null;
  matchId: string;
  clientRequestId?: string;
};

type NativeVoiceSdkUploadParams = {
  uri: string;
  matchId: string;
  clientRequestId?: string;
};

const profilePhotoResultsByClientRequestId = new Map<string, UploadImageResult>();
const chatImageResultsByClientRequestId = new Map<string, string>();
const voiceResultsByClientRequestId = new Map<string, string>();
const storageErrorsByClientRequestId = new Map<string, unknown>();

let mediaSdk: NativeMediaSdk | null = null;

function storageResultKey(
  family: NativePhotoUploadInput['family'] | NativeVoiceUploadInput['family'],
  clientRequestId: string,
): string {
  return `${family}:${clientRequestId}`;
}

function createClientRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function failClosedStorageEvaluation(flag: 'media_v2_photo' | 'media_v2_voice'): ClientFeatureFlagEvaluation {
  const now = Date.now();
  return {
    flag,
    enabled: false,
    source: 'error',
    bucket: null,
    rolloutBps: null,
    userIdBucket: null,
    fetchedAtMs: now,
    expiresAtMs: now,
  };
}

function trackMediaUploadStarted(params: {
  flag: 'media_v2_photo' | 'media_v2_voice';
  evaluation: ClientFeatureFlagEvaluation;
  path: 'media_sdk' | 'legacy';
  family: NativePhotoUploadInput['family'] | NativeVoiceUploadInput['family'];
  clientRequestId: string;
}): void {
  try {
    trackEvent('media_upload_started', {
      active_flag: params.flag,
      active_flag_enabled: params.evaluation.enabled,
      active_flag_source: params.evaluation.source,
      active_flag_bucket: params.evaluation.bucket,
      active_flag_rollout_bps: params.evaluation.rolloutBps,
      user_id_bucket: params.evaluation.userIdBucket,
      path_selected: params.path,
      family: params.family,
      platform: nativePlatform(),
      client_request_id: params.clientRequestId,
    });
    trackEvent('media_upload_sdk_flag_evaluated', {
      active_flag: params.flag,
      active_flag_enabled: params.evaluation.enabled,
      active_flag_source: params.evaluation.source,
      active_flag_bucket: params.evaluation.bucket,
      active_flag_rollout_bps: params.evaluation.rolloutBps,
      user_id_bucket: params.evaluation.userIdBucket,
      path_selected: params.path,
      family: params.family,
      platform: nativePlatform(),
      client_request_id: params.clientRequestId,
    });
  } catch {
    /* upload telemetry is best-effort and must not block media uploads */
  }
}

const nativeImageManipulator = {
  async manipulateAsync(uri: string, actions: readonly unknown[], options?: Record<string, unknown>) {
    return ImageManipulator.manipulateAsync(
      uri,
      [...actions] as Parameters<typeof ImageManipulator.manipulateAsync>[1],
      options as Parameters<typeof ImageManipulator.manipulateAsync>[2],
    );
  },
};

function nativePlatform() {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'native';
}

function requiredContextString(input: NativePhotoUploadInput | NativeVoiceUploadInput, key: string): string {
  const value = input.context?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`native_storage_${key}_missing`);
}

function optionalContextString(input: NativePhotoUploadInput | NativeVoiceUploadInput, key: string): string | undefined {
  const value = input.context?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function profileContextFromPhotoInput(input: NativePhotoUploadInput): 'onboarding' | 'profile_studio' {
  return input.context?.uploadContext === 'onboarding' ? 'onboarding' : 'profile_studio';
}

async function uploadNativePhotoViaLegacyService(
  input: NativePhotoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const resultKey = storageResultKey(input.family, clientRequestId);
  try {
    if (input.family === 'chat_photo') {
      const result = await uploadChatImageMessage(
        input.source.uri,
        input.source.mimeType ?? optionalContextString(input, 'mimeType') ?? null,
        requiredContextString(input, 'matchId'),
        clientRequestId,
      );
      chatImageResultsByClientRequestId.set(resultKey, result);
      controls.dispatch({
        type: 'ready',
        result: {
          providerPath: result,
          mediaRef: result,
          status: 'uploaded',
        },
      });
      return;
    }

    const result = await uploadProfilePhoto(
      {
        uri: input.source.uri,
        mimeType: input.source.mimeType ?? undefined,
        fileName: input.source.name ?? undefined,
      },
      profileContextFromPhotoInput(input),
      {
        clientRequestId,
        signal: (input.options?.signal as AbortSignal | null | undefined) ?? undefined,
      },
    );
    profilePhotoResultsByClientRequestId.set(resultKey, result);
    controls.dispatch({
      type: 'ready',
      result: {
        providerPath: result.path,
        mediaRef: result.path,
        status: 'uploaded',
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    throw error;
  }
}

async function uploadNativeVoiceViaLegacyService(
  input: NativeVoiceUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const resultKey = storageResultKey(input.family, clientRequestId);
  try {
    const result = await uploadVoiceMessage(
      input.source.uri,
      requiredContextString(input, 'matchId'),
      clientRequestId,
    );
    voiceResultsByClientRequestId.set(resultKey, result);
    controls.dispatch({
      type: 'ready',
      result: {
        providerPath: result,
        mediaRef: result,
        status: 'uploaded',
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    throw error;
  }
}

function getNativeStorageMediaSdk(): NativeMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createNativeMediaSdk({
      asyncStorage: AsyncStorage,
      fileSystem: FileSystem,
      imageManipulator: nativeImageManipulator,
      platform: nativePlatform(),
      telemetrySinks: nativeMediaTelemetrySinks,
      reconciler: createNativeMediaUploadReconciler(),
      delegates: {
        photo: {
          uploadProfilePhoto: uploadNativePhotoViaLegacyService,
          uploadChatPhoto: uploadNativePhotoViaLegacyService,
        },
        voice: {
          uploadVoiceNote: uploadNativeVoiceViaLegacyService,
        },
      },
    });
  }
  return mediaSdk;
}

export async function reconcileNativeStorageMediaSdkQueue(reason = 'manual'): Promise<void> {
  await getNativeStorageMediaSdk().reconcile({ reason });
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

export async function uploadProfilePhotoWithMediaSdk(
  params: NativeProfilePhotoSdkUploadParams,
): Promise<UploadImageResult> {
  const clientRequestId = params.clientRequestId ?? createClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload('media_v2_photo');
  } catch {
    evaluation = failClosedStorageEvaluation('media_v2_photo');
  }
  const path = evaluation.enabled ? 'media_sdk' : 'legacy';
  trackMediaUploadStarted({
    flag: 'media_v2_photo',
    evaluation,
    path,
    family: 'profile_photo',
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadProfilePhoto(
      {
        uri: params.asset.uri,
        mimeType: params.asset.mimeType ?? undefined,
        fileName: params.asset.name ?? params.asset.fileName ?? undefined,
      },
      params.context ?? 'profile_studio',
      {
        clientRequestId,
        signal: params.signal,
      },
    );
  }

  const task = getNativeStorageMediaSdk().photo.upload({
    family: 'profile_photo',
    source: {
      uri: params.asset.uri,
      mimeType: params.asset.mimeType ?? null,
      name: params.asset.name ?? params.asset.fileName ?? null,
      sizeBytes: params.asset.sizeBytes ?? null,
      width: params.asset.width ?? null,
      height: params.asset.height ?? null,
    },
    context: {
      uploadContext: params.context ?? 'profile_studio',
      scopeKey: `profile:${params.context ?? 'profile_studio'}`,
    },
    options: {
      clientRequestId,
      signal: params.signal ?? null,
    },
  });
  const resultKey = storageResultKey('profile_photo', clientRequestId);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = profilePhotoResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded;

    if (terminal.state === 'failed') {
      throw new Error(terminal.error?.message ?? 'Image upload failed');
    }
    const providerPath = terminal.result?.providerPath;
    if (providerPath) return { path: providerPath, sessionId: null };
    throw new Error('Image upload completed without a storage path.');
  } finally {
    profilePhotoResultsByClientRequestId.delete(resultKey);
    storageErrorsByClientRequestId.delete(resultKey);
  }
}

export async function uploadChatImageWithMediaSdk(params: NativeChatImageSdkUploadParams): Promise<string> {
  const clientRequestId = params.clientRequestId ?? createClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload('media_v2_photo');
  } catch {
    evaluation = failClosedStorageEvaluation('media_v2_photo');
  }
  const path = evaluation.enabled ? 'media_sdk' : 'legacy';
  trackMediaUploadStarted({
    flag: 'media_v2_photo',
    evaluation,
    path,
    family: 'chat_photo',
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadChatImageMessage(params.uri, params.mimeType ?? null, params.matchId, clientRequestId);
  }

  const task = getNativeStorageMediaSdk().photo.upload({
    family: 'chat_photo',
    source: {
      uri: params.uri,
      mimeType: params.mimeType ?? null,
    },
    context: {
      uploadContext: 'chat',
      scopeKey: `match:${params.matchId}`,
      matchId: params.matchId,
      mimeType: params.mimeType ?? null,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey('chat_photo', clientRequestId);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = chatImageResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded;

    if (terminal.state === 'failed') {
      throw new Error(terminal.error?.message ?? 'Image upload failed');
    }
    const mediaRef = terminal.result?.mediaRef ?? terminal.result?.providerPath;
    if (mediaRef) return mediaRef;
    throw new Error('Image upload completed without a media reference.');
  } finally {
    chatImageResultsByClientRequestId.delete(resultKey);
    storageErrorsByClientRequestId.delete(resultKey);
  }
}

export async function uploadVoiceWithMediaSdk(params: NativeVoiceSdkUploadParams): Promise<string> {
  const clientRequestId = params.clientRequestId ?? createClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload('media_v2_voice');
  } catch {
    evaluation = failClosedStorageEvaluation('media_v2_voice');
  }
  const path = evaluation.enabled ? 'media_sdk' : 'legacy';
  trackMediaUploadStarted({
    flag: 'media_v2_voice',
    evaluation,
    path,
    family: 'voice_note',
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadVoiceMessage(params.uri, params.matchId, clientRequestId);
  }

  const task = getNativeStorageMediaSdk().voice.upload({
    family: 'voice_note',
    source: {
      uri: params.uri,
      mimeType: 'audio/m4a',
      name: 'voice.m4a',
    },
    context: {
      uploadContext: 'chat',
      scopeKey: `match:${params.matchId}`,
      matchId: params.matchId,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey('voice_note', clientRequestId);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = voiceResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded;

    if (terminal.state === 'failed') {
      throw new Error(terminal.error?.message ?? 'Voice upload failed');
    }
    const mediaRef = terminal.result?.mediaRef ?? terminal.result?.providerPath;
    if (mediaRef) return mediaRef;
    throw new Error('Voice upload completed without a media reference.');
  } finally {
    voiceResultsByClientRequestId.delete(resultKey);
    storageErrorsByClientRequestId.delete(resultKey);
  }
}
