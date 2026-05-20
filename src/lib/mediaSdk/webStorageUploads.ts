import {
  createWebMediaSdk,
  isMediaUploadTerminalState,
  type MediaTaskRunContext,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type WebMediaSdk,
  type WebPhotoUploadInput,
  type WebVoiceUploadInput,
} from "@clientShared/media-sdk";
import { trackEvent } from "@/lib/analytics";
import { evaluateClientFeatureFlagForUpload, type ClientFeatureFlagEvaluation } from "@/lib/clientFeatureFlags";
import {
  uploadImageToBunny,
  type UploadImageContext,
  type UploadImageToBunnyResult,
} from "@/services/imageUploadService";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";
import { createWebMediaUploadReconciler } from "@/lib/mediaSdk/reconciliation";
import { webMediaTelemetrySinks } from "@/lib/mediaSdk/sinks";

type WebImageSdkUploadParams = {
  file: File | Blob;
  accessToken: string;
  context?: UploadImageContext;
  matchId?: string;
  clientRequestId?: string;
};

type WebVoiceSdkUploadParams = {
  blob: Blob;
  accessToken: string;
  matchId: string;
  clientRequestId?: string;
};

const photoResultsByClientRequestId = new Map<string, UploadImageToBunnyResult>();
const voiceResultsByClientRequestId = new Map<string, string>();
const storageErrorsByClientRequestId = new Map<string, unknown>();

let mediaSdk: WebMediaSdk | null = null;

function storageResultKey(family: WebPhotoUploadInput["family"] | WebVoiceUploadInput["family"], clientRequestId: string): string {
  return `${family}:${clientRequestId}`;
}

function createClientRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function failClosedStorageEvaluation(flag: "media_v2_photo" | "media_v2_voice"): ClientFeatureFlagEvaluation {
  const now = Date.now();
  return {
    flag,
    enabled: false,
    source: "error",
    bucket: null,
    rolloutBps: null,
    userIdBucket: null,
    fetchedAtMs: now,
    expiresAtMs: now,
  };
}

function trackMediaUploadStarted(params: {
  flag: "media_v2_photo" | "media_v2_voice";
  evaluation: ClientFeatureFlagEvaluation;
  path: "media_sdk" | "legacy";
  family: WebPhotoUploadInput["family"] | WebVoiceUploadInput["family"];
  clientRequestId: string;
}): void {
  try {
    trackEvent("media_upload_started", {
      active_flag: params.flag,
      active_flag_enabled: params.evaluation.enabled,
      active_flag_source: params.evaluation.source,
      active_flag_bucket: params.evaluation.bucket,
      active_flag_rollout_bps: params.evaluation.rolloutBps,
      user_id_bucket: params.evaluation.userIdBucket,
      path_selected: params.path,
      family: params.family,
      platform: "web",
      client_request_id: params.clientRequestId,
    });
    trackEvent("media_upload_sdk_flag_evaluated", {
      active_flag: params.flag,
      active_flag_enabled: params.evaluation.enabled,
      active_flag_source: params.evaluation.source,
      active_flag_bucket: params.evaluation.bucket,
      active_flag_rollout_bps: params.evaluation.rolloutBps,
      user_id_bucket: params.evaluation.userIdBucket,
      path_selected: params.path,
      family: params.family,
      platform: "web",
      client_request_id: params.clientRequestId,
    });
  } catch {
    /* upload telemetry is best-effort and must not block media uploads */
  }
}

function requiredContextString(input: WebPhotoUploadInput | WebVoiceUploadInput, key: string): string {
  const value = input.context?.[key];
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`web_storage_${key}_missing`);
}

function optionalContextString(input: WebPhotoUploadInput | WebVoiceUploadInput, key: string): string | undefined {
  const value = input.context?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function uploadContextFromPhotoInput(input: WebPhotoUploadInput): UploadImageContext {
  if (input.family === "chat_photo") return "chat";
  const value = input.context?.uploadContext;
  if (value === "onboarding" || value === "profile_studio" || value === "chat") return value;
  return "profile_studio";
}

function fileFromWebPhotoSource(source: File | Blob): File {
  if (typeof File !== "undefined" && source instanceof File) return source;
  if (typeof File === "undefined") throw new Error("web_media_file_constructor_missing");
  return new File([source], "photo.jpg", { type: source.type || "image/jpeg" });
}

async function uploadWebPhotoViaLegacyService(
  input: WebPhotoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const resultKey = storageResultKey(input.family, clientRequestId);
  try {
    const result = await uploadImageToBunny(
      fileFromWebPhotoSource(input.source),
      requiredContextString(input, "accessToken"),
      uploadContextFromPhotoInput(input),
      optionalContextString(input, "matchId"),
      clientRequestId,
    );
    photoResultsByClientRequestId.set(resultKey, result);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result.path,
        mediaRef: result.path,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    throw error;
  }
}

async function uploadWebVoiceViaLegacyService(
  input: WebVoiceUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const resultKey = storageResultKey(input.family, clientRequestId);
  try {
    const result = await uploadVoiceToBunny(
      input.source,
      requiredContextString(input, "accessToken"),
      requiredContextString(input, "matchId"),
      clientRequestId,
    );
    voiceResultsByClientRequestId.set(resultKey, result);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result,
        mediaRef: result,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    throw error;
  }
}

function getWebStorageMediaSdk(): WebMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createWebMediaSdk({
      telemetrySinks: webMediaTelemetrySinks,
      reconciler: createWebMediaUploadReconciler(),
      delegates: {
        photo: {
          uploadProfilePhoto: uploadWebPhotoViaLegacyService,
          uploadChatPhoto: uploadWebPhotoViaLegacyService,
        },
        voice: {
          uploadVoiceNote: uploadWebVoiceViaLegacyService,
        },
      },
    });
  }
  return mediaSdk;
}

export async function reconcileWebStorageMediaSdkQueue(reason = "manual"): Promise<void> {
  await getWebStorageMediaSdk().reconcile({ reason });
}

function waitForTaskTerminal(task: MediaUploadTask): Promise<MediaUploadSnapshot> {
  const current = task.snapshot();
  if (isMediaUploadTerminalState(current.state)) return Promise.resolve(current);
  return new Promise((resolve) => {
    const unsubscribe = task.on("state", (snapshot) => {
      if (!isMediaUploadTerminalState(snapshot.state)) return;
      unsubscribe();
      resolve(snapshot);
    });
  });
}

export async function uploadImageWithMediaSdk(
  params: WebImageSdkUploadParams,
): Promise<UploadImageToBunnyResult> {
  const context = params.context ?? "profile_studio";
  const family = context === "chat" ? "chat_photo" : "profile_photo";
  const clientRequestId = params.clientRequestId ?? createClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_photo");
  } catch {
    evaluation = failClosedStorageEvaluation("media_v2_photo");
  }
  const path = evaluation.enabled ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    flag: "media_v2_photo",
    evaluation,
    path,
    family,
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadImageToBunny(
      fileFromWebPhotoSource(params.file),
      params.accessToken,
      context,
      params.matchId,
      clientRequestId,
    );
  }

  const task = getWebStorageMediaSdk().photo.upload({
    family,
    source: params.file,
    context: {
      uploadContext: context,
      scopeKey: context === "chat" && params.matchId ? `match:${params.matchId}` : `profile:${context}`,
      accessToken: params.accessToken,
      matchId: params.matchId,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey(family, clientRequestId);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = photoResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded;

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Image upload failed");
    }
    const providerPath = terminal.result?.providerPath;
    if (providerPath) return { path: providerPath, sessionId: null };
    throw new Error("Image upload completed without a storage path.");
  } finally {
    photoResultsByClientRequestId.delete(resultKey);
    storageErrorsByClientRequestId.delete(resultKey);
  }
}

export async function uploadVoiceWithMediaSdk(params: WebVoiceSdkUploadParams): Promise<string> {
  const clientRequestId = params.clientRequestId ?? createClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_voice");
  } catch {
    evaluation = failClosedStorageEvaluation("media_v2_voice");
  }
  const path = evaluation.enabled ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    flag: "media_v2_voice",
    evaluation,
    path,
    family: "voice_note",
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadVoiceToBunny(params.blob, params.accessToken, params.matchId, clientRequestId);
  }

  const task = getWebStorageMediaSdk().voice.upload({
    family: "voice_note",
    source: params.blob,
    context: {
      uploadContext: "chat",
      scopeKey: `match:${params.matchId}`,
      accessToken: params.accessToken,
      matchId: params.matchId,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey("voice_note", clientRequestId);

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = voiceResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded;

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Voice upload failed");
    }
    const mediaRef = terminal.result?.mediaRef ?? terminal.result?.providerPath;
    if (mediaRef) return mediaRef;
    throw new Error("Voice upload completed without a media reference.");
  } finally {
    voiceResultsByClientRequestId.delete(resultKey);
    storageErrorsByClientRequestId.delete(resultKey);
  }
}
