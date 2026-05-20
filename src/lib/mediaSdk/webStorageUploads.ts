import {
  createMediaUploadPathTelemetryFields,
  createWebMediaSdk,
  MEDIA_UPLOAD_PATH_EVENT_NAMES,
  createMediaClientRequestId,
  waitForMediaUploadTaskTerminal,
  type MediaTaskRunContext,
  type WebMediaSdk,
  type WebPhotoUploadInput,
  type WebVoiceUploadInput,
} from "@clientShared/media-sdk";
import { failClosedUploadEvaluation } from "@clientShared/featureFlags/clientFeatureFlagCore";
import { trackEvent } from "@/lib/analytics";
import { evaluateClientFeatureFlagForUpload, type ClientFeatureFlagEvaluation } from "@/lib/clientFeatureFlags";
import { supabase } from "@/integrations/supabase/client";
import {
  uploadImageToBunny,
  type UploadImageContext,
  type UploadImageToBunnyResult,
} from "@/services/imageUploadService";
import { uploadVoiceToBunny, type UploadVoiceToBunnyResult } from "@/services/voiceUploadService";
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
const voiceResultsByClientRequestId = new Map<string, UploadVoiceToBunnyResult>();
const storageErrorsByClientRequestId = new Map<string, unknown>();
const storageCleanupTimersByResultKey = new Map<string, ReturnType<typeof setTimeout>>();
const STORAGE_TRANSIENT_STATE_TTL_MS = 60 * 60 * 1000;

let mediaSdk: WebMediaSdk | null = null;

function storageResultKey(family: WebPhotoUploadInput["family"] | WebVoiceUploadInput["family"], clientRequestId: string): string {
  return `${family}:${clientRequestId}`;
}

function trackMediaUploadStarted(params: {
  flag: "media_v2_photo" | "media_v2_voice";
  evaluation: ClientFeatureFlagEvaluation;
  path: "media_sdk" | "legacy";
  family: WebPhotoUploadInput["family"] | WebVoiceUploadInput["family"];
  clientRequestId: string;
}): void {
  try {
    const fields = createMediaUploadPathTelemetryFields({
      flag: params.flag,
      evaluation: params.evaluation,
      path: params.path,
      family: params.family,
      platform: "web",
      clientRequestId: params.clientRequestId,
    });
    for (const eventName of MEDIA_UPLOAD_PATH_EVENT_NAMES) trackEvent(eventName, fields);
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

async function accessTokenForWebStorageInput(input: WebPhotoUploadInput | WebVoiceUploadInput): Promise<string> {
  const value = optionalContextString(input, "accessToken");
  if (value) return value;
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (token) return token;
  throw new Error("web_storage_accessToken_missing");
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

async function getCachedUploadUserId(): Promise<string | null> {
  try {
    return (await supabase.auth.getSession()).data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function clearStorageTransientState(resultKey: string): void {
  const timer = storageCleanupTimersByResultKey.get(resultKey);
  if (timer) clearTimeout(timer);
  storageCleanupTimersByResultKey.delete(resultKey);
  photoResultsByClientRequestId.delete(resultKey);
  voiceResultsByClientRequestId.delete(resultKey);
  storageErrorsByClientRequestId.delete(resultKey);
}

function scheduleStorageTransientStateCleanup(resultKey: string): void {
  const existing = storageCleanupTimersByResultKey.get(resultKey);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    clearStorageTransientState(resultKey);
  }, STORAGE_TRANSIENT_STATE_TTL_MS);
  storageCleanupTimersByResultKey.set(resultKey, timer);
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
      await accessTokenForWebStorageInput(input),
      uploadContextFromPhotoInput(input),
      optionalContextString(input, "matchId"),
      clientRequestId,
    );
    photoResultsByClientRequestId.set(resultKey, result);
    scheduleStorageTransientStateCleanup(resultKey);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result.path,
        mediaRef: result.path,
        assetId: result.assetId ?? null,
        contentSha256: result.contentSha256 ?? null,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    scheduleStorageTransientStateCleanup(resultKey);
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
      await accessTokenForWebStorageInput(input),
      requiredContextString(input, "matchId"),
      clientRequestId,
    );
    voiceResultsByClientRequestId.set(resultKey, result);
    scheduleStorageTransientStateCleanup(resultKey);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result.path,
        mediaRef: result.path,
        assetId: result.assetId ?? null,
        contentSha256: result.contentSha256 ?? null,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(resultKey, error);
    scheduleStorageTransientStateCleanup(resultKey);
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

export async function uploadImageWithMediaSdk(
  params: WebImageSdkUploadParams,
): Promise<UploadImageToBunnyResult> {
  const context = params.context ?? "profile_studio";
  const family = context === "chat" ? "chat_photo" : "profile_photo";
  const matchId = params.matchId?.trim() || undefined;
  const clientRequestId = params.clientRequestId ?? createMediaClientRequestId();
  const uploadUserId = await getCachedUploadUserId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_photo", { userId: uploadUserId });
  } catch {
    evaluation = failClosedUploadEvaluation("media_v2_photo");
  }
  const canUseMediaSdk = evaluation.enabled && (context === "chat" ? !!matchId : !!uploadUserId);
  const path = canUseMediaSdk ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    flag: "media_v2_photo",
    evaluation,
    path,
    family,
    clientRequestId,
  });

  if (!canUseMediaSdk) {
    return uploadImageToBunny(
      fileFromWebPhotoSource(params.file),
      params.accessToken,
      context,
      matchId,
      clientRequestId,
    );
  }

  const task = getWebStorageMediaSdk().photo.upload({
    family,
    source: params.file,
    context: {
      uploadContext: context,
      scopeKey: context === "chat" ? `match:${matchId}` : `profile:${uploadUserId}:${context}`,
      accessToken: params.accessToken,
      matchId,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey(family, clientRequestId);
  scheduleStorageTransientStateCleanup(resultKey);

  try {
    const terminal = await waitForMediaUploadTaskTerminal(task);
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
    clearStorageTransientState(resultKey);
  }
}

export async function uploadVoiceWithMediaSdk(params: WebVoiceSdkUploadParams): Promise<string> {
  const matchId = typeof params.matchId === "string" ? params.matchId.trim() : "";
  const clientRequestId = params.clientRequestId ?? createMediaClientRequestId();
  const uploadUserId = await getCachedUploadUserId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_voice", { userId: uploadUserId });
  } catch {
    evaluation = failClosedUploadEvaluation("media_v2_voice");
  }
  const canUseMediaSdk = evaluation.enabled && !!matchId;
  const path = canUseMediaSdk ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    flag: "media_v2_voice",
    evaluation,
    path,
    family: "voice_note",
    clientRequestId,
  });

  if (!canUseMediaSdk) {
    return (await uploadVoiceToBunny(params.blob, params.accessToken, matchId, clientRequestId)).path;
  }

  const task = getWebStorageMediaSdk().voice.upload({
    family: "voice_note",
    source: params.blob,
    context: {
      uploadContext: "chat",
      scopeKey: `match:${matchId}`,
      accessToken: params.accessToken,
      matchId,
    },
    options: {
      clientRequestId,
    },
  });
  const resultKey = storageResultKey("voice_note", clientRequestId);
  scheduleStorageTransientStateCleanup(resultKey);

  try {
    const terminal = await waitForMediaUploadTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(resultKey);
    if (originalError) throw originalError;

    const uploaded = voiceResultsByClientRequestId.get(resultKey);
    if (uploaded) return uploaded.path;

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Voice upload failed");
    }
    const mediaRef = terminal.result?.mediaRef ?? terminal.result?.providerPath;
    if (mediaRef) return mediaRef;
    throw new Error("Voice upload completed without a media reference.");
  } finally {
    clearStorageTransientState(resultKey);
  }
}
