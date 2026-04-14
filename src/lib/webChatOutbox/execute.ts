import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";
import { uploadChatVideoToBunny } from "@/services/chatVideoUploadService";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { getImageUrl } from "@/utils/imageUrl";
import { formatChatImageMessageContent } from "@/lib/chatMessageContent";
import { invalidateAfterThreadMutation } from "@/hooks/useMessages";
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
    throw error;
  }
  const payload = data as { success?: boolean; message?: unknown; error?: string } | null | undefined;
  if (!payload?.success) throw new Error(payload?.error || "Send failed");
  return payload.message;
}

async function invokePublishVibeClip(params: {
  matchId: string;
  videoUrl: string;
  durationMs: number;
  clientRequestId: string;
  thumbnailUrl?: string | null;
  aspectRatio?: number | null;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    match_id: params.matchId,
    message_kind: "vibe_clip",
    video_url: params.videoUrl,
    duration_ms: params.durationMs,
    client_request_id: params.clientRequestId,
  };
  if (params.thumbnailUrl) body.thumbnail_url = params.thumbnailUrl;
  if (typeof params.aspectRatio === "number" && Number.isFinite(params.aspectRatio) && params.aspectRatio > 0) {
    body.aspect_ratio = params.aspectRatio;
  }

  const { data, error } = await supabase.functions.invoke("send-message", { body });
  if (error) {
    captureSupabaseError("publish-vibe-clip", error);
    throw error;
  }
  const payload = data as { success?: boolean; message?: unknown; error?: string } | null;
  if (!payload?.success) throw new Error(payload?.error || "Vibe Clip publish failed");
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
    throw error;
  }
  const payload = data as { success?: boolean; message?: unknown; error?: string } | null;
  if (!payload?.success) throw new Error(payload?.error || "Voice message publish failed");
  return payload.message;
}

export async function executeWebOutboxItem(
  item: WebChatOutboxItem,
  queryClient: QueryClient,
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
      let publicUrl = item.uploadedPublicUrl;
      if (!publicUrl) {
        const blob = await getOutboxBlob(payload.blobKey);
        if (!blob) throw new WebOutboxExecuteError("Photo data missing — try choosing the image again.");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");
        const file = new File([blob], "chat.jpg", { type: payload.mimeType || blob.type || "image/jpeg" });
        const { path } = await uploadImageToBunny(file, session.access_token, "chat", matchId);
        publicUrl = getImageUrl(path, { quality: 88 });
      }
      uploadedPublicUrl = publicUrl;
      const content = formatChatImageMessageContent(publicUrl);
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
      const uploaded =
        item.uploadedMediaUrl
          ? {
              videoUrl: item.uploadedMediaUrl,
              thumbnailUrl: item.uploadedPublicUrl ?? null,
              aspectRatio:
                typeof payload.aspectRatio === "number" && Number.isFinite(payload.aspectRatio) && payload.aspectRatio > 0
                  ? payload.aspectRatio
                  : null,
            }
          : await (async () => {
              const blob = await getOutboxBlob(payload.blobKey);
              if (!blob) throw new WebOutboxExecuteError("Video data missing — try recording again.");
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) throw new Error("Not authenticated");
              return uploadChatVideoToBunny(blob, session.access_token, matchId);
            })();
      uploadedMediaUrl = uploaded.videoUrl;
      uploadedPublicUrl = uploaded.thumbnailUrl ?? undefined;
      const row = await invokePublishVibeClip({
        matchId,
        videoUrl: uploaded.videoUrl,
        durationMs: Math.round(payload.durationSeconds * 1000),
        clientRequestId,
        thumbnailUrl: uploaded.thumbnailUrl,
        aspectRatio: uploaded.aspectRatio,
      });
      serverMessageId = getServerMessageId(row);
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
