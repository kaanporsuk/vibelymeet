import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";
import {
  ChatVibeClipUploadedButUnpublishedError,
  completePublishedChatVibeClipUpload,
  uploadAndPublishChatVibeClipToBunnyStream,
} from "@/services/chatVibeClipStreamUploadService";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { formatChatImageMessageContent } from "@/lib/chatMessageContent";
import { invalidateAfterThreadMutation } from "@/hooks/useMessages";
import {
  GENERIC_UPLOAD_MIME_TYPE,
  imageMimeTypeForUpload,
  uploadFileNameForMimeType,
  videoMimeTypeForUpload,
} from "@/lib/webUploadMime";
import { getOutboxBlob } from "./blobIdb";
import type { WebChatOutboxItem } from "./types";

export class WebOutboxExecuteError extends Error {
  uploadedPublicUrl?: string;
  uploadedMediaUrl?: string;

  constructor(
    message: string,
    opts?: { uploadedPublicUrl?: string; uploadedMediaUrl?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "WebOutboxExecuteError";
    this.uploadedPublicUrl = opts?.uploadedPublicUrl;
    this.uploadedMediaUrl = opts?.uploadedMediaUrl;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

function getServerMessageId(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function isBunnyStreamPlaybackRef(value: string | null | undefined): value is string {
  return /^bunny_stream:[0-9a-f-]{32,36}$/i.test(value?.trim() ?? "");
}

const BLOCKED_MESSAGE_COPY = "You can't message this person.";

type SendMessagePayload = {
  success?: boolean;
  message?: unknown;
  error?: string;
  code?: string;
};

function isBlockedSendCode(value: unknown): boolean {
  return value === "blocked_pair" || value === "message_blocked" || value === "blocked";
}

async function parseFunctionErrorPayload(error: unknown): Promise<SendMessagePayload | null> {
  const context = (error as { context?: { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> } })?.context;
  try {
    const cloned = context?.clone?.();
    const parsed = cloned?.json ? await cloned.json() : context?.json ? await context.json() : null;
    return parsed && typeof parsed === "object" ? parsed as SendMessagePayload : null;
  } catch {
    return null;
  }
}

async function throwMappedSendMessageError(error: unknown): Promise<never> {
  const payload = await parseFunctionErrorPayload(error);
  if (isBlockedSendCode(payload?.code) || isBlockedSendCode(payload?.error)) {
    throw new Error(BLOCKED_MESSAGE_COPY);
  }
  if (error instanceof Error) throw error;
  throw new Error("Send failed");
}

function assertSendMessagePayload(payload: SendMessagePayload | null | undefined, fallback: string): asserts payload is SendMessagePayload & { success: true } {
  if (!payload?.success) {
    if (isBlockedSendCode(payload?.code) || isBlockedSendCode(payload?.error)) {
      throw new Error(BLOCKED_MESSAGE_COPY);
    }
    throw new Error(payload?.error || fallback);
  }
}

async function invokeSendMessageEdge(params: {
  matchId: string;
  content: string;
  clientRequestId: string;
}): Promise<unknown> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const body: Record<string, string> = {
    match_id: params.matchId,
    content: params.content.trim(),
    client_request_id: params.clientRequestId.trim(),
  };

  const { data, error } = await supabase.functions.invoke("send-message", { body });
  if (error) {
    captureSupabaseError("send-message", error);
    await throwMappedSendMessageError(error);
  }
  const payload = data as SendMessagePayload | null | undefined;
  assertSendMessagePayload(payload, "Send failed");
  return payload.message;
}

async function invokePublishVoiceMessage(params: {
  matchId: string;
  audioUrl: string;
  durationSeconds: number;
  clientRequestId: string;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    match_id: params.matchId,
    message_kind: "voice",
    audio_url: params.audioUrl,
    audio_duration_seconds: Math.round(params.durationSeconds),
    client_request_id: params.clientRequestId,
  };

  const { data, error } = await supabase.functions.invoke("send-message", { body });
  if (error) {
    captureSupabaseError("publish-voice-message", error);
    await throwMappedSendMessageError(error);
  }
  const payload = data as SendMessagePayload | null;
  assertSendMessagePayload(payload, "Voice message publish failed");
  return payload.message;
}

export async function executeWebOutboxItem(
  item: WebChatOutboxItem,
  queryClient: QueryClient,
  onUploadProgress?: (fraction: number) => void,
): Promise<{ serverMessageId: string; uploadedPublicUrl?: string; uploadedMediaUrl?: string }> {
  const { id: clientRequestId, matchId, userId, payload } = item;
  const scope = item.invalidateScope;

  let serverMessageId: string | null = null;
  let uploadedPublicUrl: string | undefined;
  let uploadedMediaUrl: string | undefined;

  try {
    if (payload.kind === "text") {
      const row = await invokeSendMessageEdge({
        matchId,
        content: payload.text,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
    } else if (payload.kind === "image") {
      let mediaRef = item.uploadedPublicUrl;
      if (!mediaRef) {
        const blob = await getOutboxBlob(payload.blobKey);
        if (!blob) throw new WebOutboxExecuteError("Photo data missing — try choosing the image again.");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");
        const storedName =
          payload.fileName ||
          (typeof File !== "undefined" && blob instanceof File ? blob.name : undefined);
        const mimeType =
          imageMimeTypeForUpload(blob.type, storedName) ??
          imageMimeTypeForUpload(payload.mimeType, storedName) ??
          GENERIC_UPLOAD_MIME_TYPE;
        const file = new File([blob], uploadFileNameForMimeType("image", "chat", mimeType, storedName), { type: mimeType });
        const { path } = await uploadImageToBunny(file, session.access_token, "chat", matchId);
        mediaRef = path;
      }
      uploadedPublicUrl = mediaRef;
      const content = formatChatImageMessageContent(mediaRef);
      const row = await invokeSendMessageEdge({ matchId, content, clientRequestId });
      serverMessageId = getServerMessageId(row);
    } else if (payload.kind === "voice") {
      let audioUrl = item.uploadedMediaUrl;
      if (!audioUrl) {
        const blob = await getOutboxBlob(payload.blobKey);
        if (!blob) throw new WebOutboxExecuteError("Voice data missing — try recording again.");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");
        audioUrl = await uploadVoiceToBunny(blob, session.access_token, matchId);
      }
      uploadedMediaUrl = audioUrl;
      const row = await invokePublishVoiceMessage({
        matchId,
        audioUrl,
        durationSeconds: payload.durationSeconds,
        clientRequestId,
      });
      serverMessageId = getServerMessageId(row);
    } else {
      let uploaded: Awaited<ReturnType<typeof uploadAndPublishChatVibeClipToBunnyStream>>;
      if (isBunnyStreamPlaybackRef(item.uploadedMediaUrl)) {
        uploaded = await completePublishedChatVibeClipUpload({
          clientRequestId,
          playbackRef: item.uploadedMediaUrl,
        });
      } else {
        const blob = await getOutboxBlob(payload.blobKey);
        if (!blob) throw new WebOutboxExecuteError("Video data missing — try recording again.");
        const storedName =
          payload.fileName ||
          (typeof File !== "undefined" && blob instanceof File ? blob.name : undefined);
        const mimeType =
          videoMimeTypeForUpload(blob.type, storedName) ??
          videoMimeTypeForUpload(payload.mimeType, storedName) ??
          GENERIC_UPLOAD_MIME_TYPE;
        const file = new File([blob], uploadFileNameForMimeType("video", "chat-vibe-clip", mimeType, storedName), {
          type: mimeType,
        });
        try {
          uploaded = await uploadAndPublishChatVibeClipToBunnyStream({
            matchId,
            clientRequestId,
            file,
            durationMs: Math.round(payload.durationSeconds * 1000),
            aspectRatio: payload.aspectRatio,
            onProgress: onUploadProgress,
          });
        } catch (error) {
          if (error instanceof ChatVibeClipUploadedButUnpublishedError) {
            uploadedMediaUrl = error.playbackRef;
            uploadedPublicUrl = error.posterRef;
          }
          throw error;
        }
      }
      uploadedMediaUrl = uploaded.playbackRef;
      uploadedPublicUrl = uploaded.posterRef;
      serverMessageId = uploaded.messageId || getServerMessageId(uploaded.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    throw new WebOutboxExecuteError(msg, { uploadedPublicUrl, uploadedMediaUrl, cause: e });
  }

  if (!serverMessageId) {
    throw new Error("Send succeeded but no message id returned.");
  }

  invalidateAfterThreadMutation(queryClient, scope);

  return { serverMessageId, uploadedPublicUrl, uploadedMediaUrl };
}

export function nextBackoffMs(attemptCount: number): number {
  const step = Math.min(6, Math.max(0, attemptCount));
  return Math.min(60_000, 1000 * Math.pow(2, step));
}
