import {
  createStaticMediaFeatureFlagGate,
  createWebMediaSdk,
  isMediaUploadTerminalState,
  type MediaTaskRunContext,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type WebMediaSdk,
  type WebPhotoUploadInput,
  type WebVoiceUploadInput,
} from "@clientShared/media-sdk";
import {
  uploadImageToBunny,
  type UploadImageContext,
  type UploadImageToBunnyResult,
} from "@/services/imageUploadService";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";

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

const mediaV2StorageGate = createStaticMediaFeatureFlagGate({
  media_v2_photo: true,
  media_v2_voice: true,
});

const photoResultsByClientRequestId = new Map<string, UploadImageToBunnyResult>();
const voiceResultsByClientRequestId = new Map<string, string>();
const storageErrorsByClientRequestId = new Map<string, unknown>();

let mediaSdk: WebMediaSdk | null = null;

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
  try {
    const result = await uploadImageToBunny(
      fileFromWebPhotoSource(input.source),
      requiredContextString(input, "accessToken"),
      uploadContextFromPhotoInput(input),
      optionalContextString(input, "matchId"),
      clientRequestId,
    );
    photoResultsByClientRequestId.set(clientRequestId, result);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result.path,
        mediaRef: result.path,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(clientRequestId, error);
    throw error;
  }
}

async function uploadWebVoiceViaLegacyService(
  input: WebVoiceUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  try {
    const result = await uploadVoiceToBunny(
      input.source,
      requiredContextString(input, "accessToken"),
      requiredContextString(input, "matchId"),
      clientRequestId,
    );
    voiceResultsByClientRequestId.set(clientRequestId, result);
    controls.dispatch({
      type: "ready",
      result: {
        providerPath: result,
        mediaRef: result,
        status: "uploaded",
      },
    });
  } catch (error) {
    storageErrorsByClientRequestId.set(clientRequestId, error);
    throw error;
  }
}

function getWebStorageMediaSdk(): WebMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createWebMediaSdk({
      flagGate: mediaV2StorageGate,
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
  const task = getWebStorageMediaSdk().photo.upload({
    family: context === "chat" ? "chat_photo" : "profile_photo",
    source: params.file,
    context: {
      uploadContext: context,
      scopeKey: context === "chat" && params.matchId ? `match:${params.matchId}` : `profile:${context}`,
      accessToken: params.accessToken,
      matchId: params.matchId,
    },
    options: {
      clientRequestId: params.clientRequestId,
    },
  });
  const clientRequestId = task.clientRequestId;

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(clientRequestId);
    if (originalError) throw originalError;

    const uploaded = photoResultsByClientRequestId.get(clientRequestId);
    if (uploaded) return uploaded;

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Image upload failed");
    }
    const providerPath = terminal.result?.providerPath;
    if (providerPath) return { path: providerPath, sessionId: null };
    throw new Error("Image upload completed without a storage path.");
  } finally {
    photoResultsByClientRequestId.delete(clientRequestId);
    storageErrorsByClientRequestId.delete(clientRequestId);
  }
}

export async function uploadVoiceWithMediaSdk(params: WebVoiceSdkUploadParams): Promise<string> {
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
      clientRequestId: params.clientRequestId,
    },
  });
  const clientRequestId = task.clientRequestId;

  try {
    const terminal = await waitForTaskTerminal(task);
    const originalError = storageErrorsByClientRequestId.get(clientRequestId);
    if (originalError) throw originalError;

    const uploaded = voiceResultsByClientRequestId.get(clientRequestId);
    if (uploaded) return uploaded;

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Voice upload failed");
    }
    const mediaRef = terminal.result?.mediaRef ?? terminal.result?.providerPath;
    if (mediaRef) return mediaRef;
    throw new Error("Voice upload completed without a media reference.");
  } finally {
    voiceResultsByClientRequestId.delete(clientRequestId);
    storageErrorsByClientRequestId.delete(clientRequestId);
  }
}
