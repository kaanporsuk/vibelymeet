import {
  createMediaUploadPathTelemetryFields,
  createMediaClientRequestId,
  createWebMediaSdk,
  MEDIA_UPLOAD_PATH_EVENT_NAMES,
  waitForMediaUploadTaskTerminal,
  type MediaUploadSnapshot,
  type MediaUploadTask,
  type MediaTaskRunContext,
  type WebMediaSdk,
  type WebVideoUploadInput,
} from "@clientShared/media-sdk";
import { failClosedUploadEvaluation } from "@clientShared/featureFlags/clientFeatureFlagCore";
import { trackEvent } from "@/lib/analytics";
import { evaluateClientFeatureFlagForUpload, type ClientFeatureFlagEvaluation } from "@/lib/clientFeatureFlags";
import {
  heroVideoGetState,
  heroVideoReset,
  heroVideoStartWithClientRequestId,
  heroVideoSubscribe,
  type HeroVideoControllerState,
  type HeroVideoUploadContext,
} from "@/lib/heroVideo/heroVideoUploadController";
import {
  uploadAndPublishChatVibeClipToBunnyStream,
  type ChatVibeClipStreamUploadResult,
} from "@/services/chatVibeClipStreamUploadService";
import { createWebMediaUploadReconciler } from "@/lib/mediaSdk/reconciliation";
import { webMediaTelemetrySinks } from "@/lib/mediaSdk/sinks";

type WebChatVibeClipSdkUploadParams = Parameters<typeof uploadAndPublishChatVibeClipToBunnyStream>[0];

const chatClipResultsByClientRequestId = new Map<string, ChatVibeClipStreamUploadResult>();
const chatClipErrorsByClientRequestId = new Map<string, unknown>();
const chatClipProgressByClientRequestId = new Map<string, ((fraction: number) => void) | undefined>();
const chatClipCleanupTimersByClientRequestId = new Map<string, ReturnType<typeof setTimeout>>();
const CHAT_CLIP_TRANSIENT_STATE_TTL_MS = 60 * 60 * 1000;

let mediaSdk: WebMediaSdk | null = null;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function trackMediaUploadStarted(params: {
  evaluation: ClientFeatureFlagEvaluation;
  path: "media_sdk" | "legacy";
  family: WebVideoUploadInput["family"];
  clientRequestId: string;
}): void {
  try {
    const fields = createMediaUploadPathTelemetryFields({
      flag: "media_v2_video",
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

function uploadContextFromInput(input: WebVideoUploadInput): HeroVideoUploadContext {
  const value = input.context?.uploadContext ?? "profile_studio";
  if (value === "onboarding" || value === "profile_studio") return value;
  throw new Error("vibe_video_invalid_upload_context");
}

function captionFromInput(input: WebVideoUploadInput): string | undefined {
  return optionalString(input.context?.caption);
}

function pendingLocalPreviewUrlFromInput(input: WebVideoUploadInput): string | null {
  return optionalString(input.context?.pendingLocalPreviewUrl) ?? null;
}

function uploadStartErrorFromSnapshot(snapshot: MediaUploadSnapshot): Error {
  return new Error(snapshot.error?.message ?? "Could not start upload. Please try again.");
}

function hasHeroVideoControllerHandoff(clientRequestId: string): boolean {
  return heroVideoGetState().clientRequestId === clientRequestId;
}

function waitForVibeVideoControllerHandoff(task: MediaUploadTask, clientRequestId: string): Promise<void> {
  if (hasHeroVideoControllerHandoff(clientRequestId)) return Promise.resolve();

  const snapshot = task.snapshot();
  if (snapshot.state === "failed" || snapshot.state === "cancelled") {
    return Promise.reject(uploadStartErrorFromSnapshot(snapshot));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeController: (() => void) | null = null;
    let unsubscribeTask: (() => void) | null = null;

    const cleanup = () => {
      unsubscribeController?.();
      unsubscribeTask?.();
      unsubscribeController = null;
      unsubscribeTask = null;
    };

    const settle = (result: "resolve" | "reject", error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result === "reject") reject(error ?? new Error("Could not start upload. Please try again."));
      else resolve();
    };

    const check = () => {
      if (hasHeroVideoControllerHandoff(clientRequestId)) {
        settle("resolve");
        return;
      }
      const current = task.snapshot();
      if (current.state === "failed" || current.state === "cancelled") {
        settle("reject", uploadStartErrorFromSnapshot(current));
      }
    };

    unsubscribeController = heroVideoSubscribe(check);
    unsubscribeTask = task.on("state", check);
    check();
  });
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
    { pendingLocalPreviewUrl: pendingLocalPreviewUrlFromInput(input) },
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
  const candidateName = (source as { name?: unknown }).name;
  const fileName = typeof candidateName === "string" && candidateName.trim()
    ? candidateName.trim()
    : "chat-vibe-clip.mp4";
  return new File([source], fileName, { type: source.type || "video/mp4" });
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
      captions: input.context?.captions,
      resumeStrategy: input.context?.resumeStrategy === "reissue_credentials" ? "reissue_credentials" : undefined,
      signal: (input.options?.signal as AbortSignal | null | undefined) ?? undefined,
      onProgress: (fraction) => {
        controls.dispatch({ type: "progress", progress: fraction });
        onProgress?.(fraction);
        scheduleChatClipTransientStateCleanup(clientRequestId);
      },
    });
    chatClipResultsByClientRequestId.set(clientRequestId, uploaded);
    scheduleChatClipTransientStateCleanup(clientRequestId);
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
    scheduleChatClipTransientStateCleanup(clientRequestId);
    throw error;
  }
}

function getWebVideoMediaSdk(): WebMediaSdk {
  if (!mediaSdk) {
    mediaSdk = createWebMediaSdk({
      telemetrySinks: webMediaTelemetrySinks,
      reconciler: createWebMediaUploadReconciler(),
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

export async function reconcileWebVideoMediaSdkQueue(reason = "manual"): Promise<void> {
  await getWebVideoMediaSdk().reconcile({ reason });
}

export function startWebVibeVideoUpload(params: {
  source: File | Blob;
  caption?: string;
  context?: HeroVideoUploadContext;
  pendingLocalPreviewUrl?: string | null;
}): Promise<void> {
  const context = params.context ?? "profile_studio";
  const clientRequestId = createMediaClientRequestId();
  return startWebVibeVideoUploadAfterGate(params, context, clientRequestId);
}

async function startWebVibeVideoUploadAfterGate(
  params: {
    source: File | Blob;
    caption?: string;
    context?: HeroVideoUploadContext;
    pendingLocalPreviewUrl?: string | null;
  },
  context: HeroVideoUploadContext,
  clientRequestId: string,
): Promise<void> {
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_video");
  } catch {
    evaluation = failClosedUploadEvaluation("media_v2_video");
  }
  const path = evaluation.enabled ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    evaluation,
    path,
    family: "vibe_video",
    clientRequestId,
  });

  if (!evaluation.enabled) {
    heroVideoStartWithClientRequestId(params.source, params.caption, context, clientRequestId, {
      pendingLocalPreviewUrl: params.pendingLocalPreviewUrl ?? null,
    });
    return;
  }
  const task = getWebVideoMediaSdk().video.upload({
    family: "vibe_video",
    source: params.source,
    context: {
      uploadContext: context,
      caption: params.caption,
      pendingLocalPreviewUrl: params.pendingLocalPreviewUrl ?? null,
    },
    options: {
      clientRequestId,
    },
  });
  await waitForVibeVideoControllerHandoff(task, clientRequestId);
}

export async function uploadAndPublishChatVibeClipWithMediaSdk(
  params: WebChatVibeClipSdkUploadParams,
): Promise<ChatVibeClipStreamUploadResult> {
  const clientRequestId = params.clientRequestId ?? createMediaClientRequestId();
  let evaluation: ClientFeatureFlagEvaluation;
  try {
    evaluation = await evaluateClientFeatureFlagForUpload("media_v2_video");
  } catch {
    evaluation = failClosedUploadEvaluation("media_v2_video");
  }
  const path = evaluation.enabled ? "media_sdk" : "legacy";
  trackMediaUploadStarted({
    evaluation,
    path,
    family: "chat_vibe_clip",
    clientRequestId,
  });

  if (!evaluation.enabled) {
    return uploadAndPublishChatVibeClipToBunnyStream({ ...params, clientRequestId });
  }

  const task = getWebVideoMediaSdk().video.upload({
    family: "chat_vibe_clip",
    source: params.file,
    context: {
      uploadContext: "chat",
      scopeKey: params.matchId,
      matchId: params.matchId,
      durationMs: params.durationMs,
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

    if (terminal.state === "failed") {
      throw new Error(terminal.error?.message ?? "Could not publish Vibe Clip.");
    }
    throw new Error("Vibe Clip upload completed without a publish result.");
  } finally {
    clearChatClipTransientState(clientRequestId);
  }
}
