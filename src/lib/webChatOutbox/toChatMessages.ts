import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
} from "@/lib/chatMessageContent";
import type { MessageStatusType } from "@/components/chat/MessageStatus";
import type { WebChatOutboxItem } from "./types";
import {
  outboxPhaseStatusPresentation,
  type OutboxPayloadKind,
} from "../../../shared/chat/outgoingStatusLabels";

export type OutboxPreviewMap = Record<string, { image?: string; audio?: string; video?: string }>;

function payloadKindForLabel(item: WebChatOutboxItem): OutboxPayloadKind {
  const k = item.payload.kind;
  if (k === "text") return "text";
  if (k === "image") return "image";
  if (k === "voice") return "voice";
  return "video";
}

export type OutboxChatMessageRow = {
  id: string;
  text: string;
  sender: "me";
  time: string;
  type: "text" | "image" | "voice" | "video" | "vibe_clip" | "date-suggestion" | "date-suggestion-event" | "vibe-game-session";
  duration?: number;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  videoDuration?: number;
  status?: MessageStatusType;
  sendError?: string;
  clientRequestId?: string;
  sortAtMs?: number;
  structuredPayload?: Record<string, unknown> | null;
  outboxItemId?: string;
  statusSubtext?: string;
  statusAssistive?: string;
  suppressSendingIndicator?: boolean;
  showSendingSpinner?: boolean;
};

export function webOutboxItemsToRows(
  items: WebChatOutboxItem[],
  previews: OutboxPreviewMap,
  nowMs = Date.now(),
): OutboxChatMessageRow[] {
  const rows: OutboxChatMessageRow[] = [];
  for (const it of items) {
    if (it.state === "sent" || it.state === "canceled") continue;

    const t = new Date(it.createdAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const labelKind = payloadKindForLabel(it);
    const uploadPercent =
      it.payload.kind !== "text" &&
      it.state === "sending" &&
      typeof it.uploadProgress === "number" &&
      Number.isFinite(it.uploadProgress)
        ? Math.max(0, Math.min(100, Math.round(it.uploadProgress * 100)))
        : null;
    const presentation = outboxPhaseStatusPresentation(it.state, labelKind, {
      ageMs: Math.max(0, nowMs - it.createdAtMs),
      uploadPercent,
    });

    let status: MessageStatusType = "sending";
    let sendError: string | undefined;
    if (it.state === "failed" && it.lastError) {
      status = "sent";
      sendError = it.lastError;
    }

    const base = {
      id: `outbox-${it.id}`,
      sender: "me" as const,
      time: t,
      clientRequestId: it.id,
      outboxItemId: it.id,
      sortAtMs: it.createdAtMs,
      statusSubtext: it.state === "failed" ? undefined : presentation.visibleLabel ?? undefined,
      statusAssistive: presentation.assistiveLabel,
      suppressSendingIndicator: !presentation.showSpinner,
      showSendingSpinner: presentation.showSpinner,
    };

    if (it.payload.kind === "text") {
      rows.push({
        ...base,
        text: it.payload.text,
        type: inferChatMediaRenderKind({ content: it.payload.text }) === "image" ? "image" : "text",
        status,
        sendError,
      });
    } else if (it.payload.kind === "image") {
      const url = previews[it.id]?.image;
      rows.push({
        ...base,
        text: url ? formatChatImageMessageContent(url) : " ",
        type: "image",
        status,
        sendError,
      });
    } else if (it.payload.kind === "voice") {
      const url = previews[it.id]?.audio;
      rows.push({
        ...base,
        text: "",
        type: "voice",
        audioUrl: url,
        audioDuration: it.payload.durationSeconds,
        status,
        sendError,
      });
    } else {
      const url = previews[it.id]?.video;
      const aspectRatio =
        typeof it.payload.aspectRatio === "number" && Number.isFinite(it.payload.aspectRatio) && it.payload.aspectRatio > 0
          ? it.payload.aspectRatio
          : null;
      rows.push({
        ...base,
        text: "",
        type: "vibe_clip",
        videoUrl: url,
        videoDuration: it.payload.durationSeconds,
        structuredPayload: {
          v: 3,
          kind: "vibe_clip",
          client_request_id: it.id,
          duration_ms: Math.round(it.payload.durationSeconds * 1000),
          thumbnail_url: null,
          poster_ref: null,
          poster_source: "bunny_stream_thumbnail",
          aspect_ratio: aspectRatio,
          processing_status: it.state === "awaiting_hydration" ? "processing" : "uploading",
          upload_provider: "bunny_stream",
          provider: "bunny_stream",
        },
        status,
        sendError,
      });
    }
  }
  return rows;
}
