import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
} from "@/lib/chatMessageContent";
import type { MessageStatusType } from "@/components/chat/MessageStatus";
import type { WebChatOutboxItem } from "./types";
import { outboxPhaseStatusLabel, type OutboxPayloadKind } from "../../../shared/chat/outgoingStatusLabels";

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
};

export function webOutboxItemsToRows(items: WebChatOutboxItem[], previews: OutboxPreviewMap): OutboxChatMessageRow[] {
  const rows: OutboxChatMessageRow[] = [];
  for (const it of items) {
    if (it.state === "sent" || it.state === "canceled") continue;

    const t = new Date(it.createdAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const labelKind = payloadKindForLabel(it);
    const sub = outboxPhaseStatusLabel(it.state as Parameters<typeof outboxPhaseStatusLabel>[0], labelKind);

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
      statusSubtext: it.state === "failed" ? undefined : sub,
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
      rows.push({
        ...base,
        text: "",
        type: "vibe_clip",
        videoUrl: url,
        videoDuration: it.payload.durationSeconds,
        structuredPayload: { client_request_id: it.id },
        status,
        sendError,
      });
    }
  }
  return rows;
}
