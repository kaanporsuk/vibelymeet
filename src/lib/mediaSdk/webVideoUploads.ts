import {
  createStaticMediaFeatureFlagGate,
  createWebMediaSdk,
  isMediaUploadTerminalState,
  type MediaTaskRunContext,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type WebMediaSdk,
  type WebVideoUploadInput,
} from "@clientShared/media-sdk";
import {
  heroVideoGetState,
  heroVideoReset,
  heroVideoStart,
  heroVideoStartWithClientRequestId,
  heroVideoSubscribe,
  type HeroVideoControllerState,
  type HeroVideoUploadContext,
} from "@/lib/heroVideo/heroVideoUploadController";
import {
  uploadAndPublishChatVibeClipToBunnyStream,
  type ChatVibeClipStreamUploadResult,
} from "@/services/chatVibeClipStreamUploadService";

type WebChatVibeClipSdkUploadParams = Parameters<typeof uploadAndPublishChatVibeClipToBunnyStream>[0];

const mediaV2VideoGate = createStaticMediaFeatureFlagGate({ media_v2_video: true });
const chatClipResultsByClientRequestId = new Map<string, ChatVibeClipStreamUploadResult>();
const chatClipErrorsByClientRequestId = new Map<string, unknown>();
const chatClipProgressByClientRequestId = new Map<string, ((fraction: number) => void) | undefined>();

let mediaSdk: WebMediaSdk | null = null;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function uploadContextFromInput(input: WebVideoUploadInput): HeroVideoUploadContext {
  return input.context?.uploadContext === "onboarding" ? "onboarding" : "profile_studio";
}

function captionFromInput(input: WebVideoUploadInput): string | undefined {
  return optionalString(input.context?.caption);
}

function failSnapshotForHeroState(state: HeroVideoControllerState): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (state.phase === "stalled") {
    return {
      code: "vibe_video_processing_stalled",
      message: state.errorMessage ?? "Your video is taking longer than expected.",
      retryable: true,
    };
  }
  return {
    code: "vibe_video_upload_failed",
    message: state.errorMessage ?? "Upload failed. Please try again.",
    retryable: true,
  };
}

function shouldResetHeroVideoForTask(state: HeroVideoControllerState, clientRequestId: string): boolean {
  return state.clientRequestId === clientRequestId && state.phase !== "ready";
}

function mirrorHeroVideoControllerToSdk(controls: MediaTaskRunContext): Promise<void> {
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
    const applyState = (state: HeroVideoControllerState) => {
      if (settled) return;
      if (state.clientRequestId !== clientRequestId) {
        controls.dispatch({ type: "cancel", reason: "vibe_video_upload_replaced" });
        finish();
        return;
      }
      if (state.phase === "uploading") {
        controls.dispatch({ type: "progress", progress: state.uploadProgress / 100 });
        return;
      }
      if (state.phase === "processing") {
        controls.dispatch({ type: "upload_complete" });
        return;
      }
      if (state.phase === "ready") {
        controls.dispatch({
          type: "ready",
          result: {
            providerObjectId: state.videoId,
            status: "ready",
          },
        });
        finish();
        return;
      }
      if (state.phase === "failed" || state.phase === "stalled") {
        controls.dispatch({ type: "fail", error: failSnapshotForHeroState(state) });
        finish();
        return;
      }
      if (state.phase === "idle") {
        controls.dispatch({ type: "cancel", reason: "vibe_video_controller_idle" });
        finish();
      }
    };

    unsubscribe = heroVideoSubscribe(applyState);
    applyState(heroVideoGetState());
  });
}

async function uploadWebVibeVideoViaController(
  input: WebVideoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  controls.bindLifecycle({
    cancel: () => {
      if (shouldResetHeroVideoForTask(heroVideoGetState(), clientRequestId)) heroVideoReset();
    },
  });
  heroVideoStartWithClientRequestId(
    input.source,
    captionFromInput(input),
    uploadContextFromInput(input),
    clientRequestId,
  );
  await mirrorHeroVideoControllerToSdk(controls);
}

function requiredContextString(input: WebVideoUploadInput, key: string): string {
  const value = input.context?.[key];
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`chat_vibe_clip_${key}_missing`);
}

function requiredContextNumber(input: WebVideoUploadInput, key: string): number {
  const value = input.context?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`chat_vibe_clip_${key}_missing`);
}

function fileFromWebVideoSource(source: File | Blob): File {
  if (typeof File !== "undefined" && source instanceof File) return source;
  if (typeof File === "undefined") throw new Error("web_media_file_constructor_missing");
  return new File([source], "chat-vibe-clip.mp4", { type: source.type || "video/mp4" });
}

async function uploadWebChatVibeClipViaLegacyService(
  input: WebVideoUploadInput,
  controls: MediaTaskRunContext,
): Promise<void> {
  const clientRequestId = controls.snapshot().clientRequestId;
  const onProgress = chatClipProgressByClientRequestId.get(clientRequestId);
  try {
    const uploaded = await uploadAndPublishChatVibeClipToBunnyStream({
      matchId: requiredContextString(input, "matchId"),
      clientRequestId,
      file: fileFromWebVideoSource(input.source),
      durationMs: requiredContextNumber(input, "durationMs"),
      aspectRatio: typeof input.context?.aspectRatio === "number" ? input.context.aspectRatio : null,
      onProgress: (fraction) => {
        controls.dispatch({ type: "progress", progress: fraction });
        onProgress?.(fraction);
      },
    });
    chatClipResultsByClientRequestId.set(clientRequestId, uploaded);
    controls.dispatch({
      type: "ready",
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

function getWebVideoMediaSdk(): WebMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createWebMediaSdk({
      flagGate: mediaV2VideoGate,
      delegates: {
        video: {
          uploadVibeVideo: uploadWebVibeVideoViaController,
          uploadChatVibeClip: uploadWebChatVibeClipViaLegacyService,
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

export function startWebVibeVideoUpload(params: {
  source: File | Blob;
  caption?: string;
  context?: HeroVideoUploadContext;
  mediaV2VideoEnabled: boolean;
}): void {
  const context = params.context ?? "profile_studio";
  if (!params.mediaV2VideoEnabled) {
    heroVideoStart(params.source, params.caption, context);
    return;
  }

  getWebVideoMediaSdk().video.upload({
    family: "vibe_video",
    source: params.source,
    context: {
      uploadContext: context,
      caption: params.caption,
    },
  });
}

export async function uploadAndPublishChatVibeClipWithMediaSdk(
  params: WebChatVibeClipSdkUploadParams,
): Promise<ChatVibeClipStreamUploadResult> {
  const task = getWebVideoMediaSdk().video.upload({
    family: "chat_vibe_clip",
    source: params.file,
    context: {
      uploadContext: "chat",
      scopeKey: params.matchId,
      matchId: params.matchId,
      durationMs: params.durationMs,
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

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Could not publish Vibe Clip.");
    }
    throw new Error("Vibe Clip upload completed without a publish result.");
  } finally {
    chatClipProgressByClientRequestId.delete(clientRequestId);
    chatClipResultsByClientRequestId.delete(clientRequestId);
    chatClipErrorsByClientRequestId.delete(clientRequestId);
  }
}
