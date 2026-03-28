/**
 * Structured last-message preview for match / conversation list rows (web + native).
 * Never surfaces transport encodings like `__IMAGE__|…` or raw media URLs as the preview text.
 */

import { parseVibeGameEnvelopeFromStructuredPayload } from "../vibely-games/parse";
import type { GameType } from "../vibely-games/types";
import {
  CHAT_IMAGE_MESSAGE_PREFIX,
  inferChatMediaRenderKind,
  normalizeChatDbMessageKind,
  parseChatImageMessageContent,
  type ChatDbMessageKind,
} from "./messageRouting";

const PREVIEW_MAX_LEN = 80;

export type ConversationPreviewKind =
  | "empty"
  | "text"
  | "image"
  | "video"
  | "voice"
  | "vibe_clip"
  | "date"
  | "game"
  | "call"
  | "unknown";

export type ConversationPreview = {
  prefix: "You" | null;
  text: string;
  kind: ConversationPreviewKind;
  presentation: "plain" | "label" | "empty_state";
};

export type ConversationListPreviewRowInput = {
  content: string | null | undefined;
  message_kind?: string | null;
  audio_url?: string | null;
  video_url?: string | null;
  sender_id?: string | null;
  structured_payload?: unknown;
};

function truncatePreview(s: string): string {
  if (s.length <= PREVIEW_MAX_LEN) return s;
  return `${s.slice(0, PREVIEW_MAX_LEN)}…`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

const GAME_TYPE_LABEL: Record<GameType, string> = {
  "2truths": "Two truths",
  would_rather: "Would you rather",
  charades: "Charades",
  scavenger: "Scavenger hunt",
  roulette: "Roulette",
  intuition: "Intuition",
};

function isTransportOrBareUrlLine(s: string): boolean {
  const t = s.trim();
  if (t.startsWith("__IMAGE__|")) return true;
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  return false;
}

function gamePreviewText(structured: unknown, content: string): string {
  const env = parseVibeGameEnvelopeFromStructuredPayload(structured);
  if (env?.game_type && GAME_TYPE_LABEL[env.game_type]) {
    return GAME_TYPE_LABEL[env.game_type]!;
  }
  const t = content.trim();
  if (t.length > 0 && !isTransportOrBareUrlLine(t)) {
    return truncatePreview(t);
  }
  return "Game";
}

function dateEventKindLabel(kind: string): string | null {
  const map: Record<string, string> = {
    date_suggestion_accepted: "Date confirmed",
    declined: "Date declined",
    cancelled: "Date cancelled",
    not_now: "Not now",
  };
  return map[kind] ?? null;
}

function datePreviewText(dbKind: ChatDbMessageKind, structured: unknown, content: string): string {
  if (dbKind === "date_suggestion") {
    const sp = asRecord(structured);
    if (sp?.event === "counter") return "Date update";
    return "Date suggestion";
  }
  if (dbKind === "date_suggestion_event") {
    const sp = asRecord(structured);
    const k = sp?.kind;
    if (typeof k === "string") {
      const fixed = dateEventKindLabel(k);
      if (fixed) return fixed;
    }
    const t = content.trim();
    if (t.length > 0 && !isTransportOrBareUrlLine(t)) {
      return truncatePreview(t);
    }
    return "Date update";
  }
  return "Date update";
}

function youPrefix(senderId: string | null | undefined, currentUserId: string | null | undefined): "You" | null {
  if (!senderId || !currentUserId) return null;
  return senderId === currentUserId ? "You" : null;
}

/** Zero-message conversation: list empty state (not the same as an unknown/malformed row). */
export function getEmptyConversationPreview(): ConversationPreview {
  return { prefix: null, text: "New match", kind: "empty", presentation: "empty_state" };
}

/** Lowercased tokens for client-side “matched on message” search. */
export function conversationPreviewSearchText(preview: ConversationPreview): string {
  return [preview.prefix === "You" ? "you" : "", preview.text].filter(Boolean).join(" ").trim().toLowerCase();
}

export function getConversationPreview(
  row: ConversationListPreviewRowInput,
  currentUserId: string | null | undefined,
): ConversationPreview {
  const prefix = youPrefix(row.sender_id ?? null, currentUserId);
  const raw = typeof row.content === "string" ? row.content : "";
  const trimmed = raw.trim();
  const kind = row.message_kind ?? null;
  const audioUrl =
    typeof row.audio_url === "string" && row.audio_url.trim() ? row.audio_url.trim() : null;
  const videoUrl =
    typeof row.video_url === "string" && row.video_url.trim() ? row.video_url.trim() : null;

  const mediaKind = inferChatMediaRenderKind({
    content: trimmed,
    audioUrl,
    videoUrl,
    messageKind: kind,
  });

  if (mediaKind === "image") {
    return { prefix, text: "Photo", kind: "image", presentation: "label" };
  }
  if (mediaKind === "voice") {
    return { prefix, text: "Voice message", kind: "voice", presentation: "label" };
  }
  if (mediaKind === "vibe_clip") {
    return { prefix, text: "Vibe Clip", kind: "vibe_clip", presentation: "label" };
  }
  if (mediaKind === "video") {
    return { prefix, text: "Video", kind: "video", presentation: "label" };
  }

  const dbKind = normalizeChatDbMessageKind(kind);
  if (dbKind === "date_suggestion" || dbKind === "date_suggestion_event") {
    return {
      prefix,
      text: datePreviewText(dbKind, row.structured_payload, raw),
      kind: "date",
      presentation: "label",
    };
  }
  if (dbKind === "vibe_game" || dbKind === "vibe_game_session") {
    return {
      prefix,
      text: gamePreviewText(row.structured_payload, raw),
      kind: "game",
      presentation: "label",
    };
  }

  if (parseChatImageMessageContent(trimmed)) {
    return { prefix, text: "Photo", kind: "image", presentation: "label" };
  }

  if (trimmed.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) {
    return { prefix, text: "Photo", kind: "image", presentation: "label" };
  }

  if (!trimmed) {
    if (audioUrl) {
      return { prefix, text: "Voice message", kind: "voice", presentation: "label" };
    }
    if (videoUrl) {
      return { prefix, text: "Video", kind: "video", presentation: "label" };
    }
    return { prefix, text: "Message", kind: "unknown", presentation: "label" };
  }

  if (isTransportOrBareUrlLine(trimmed)) {
    return { prefix, text: "Message", kind: "unknown", presentation: "label" };
  }

  return {
    prefix,
    text: truncatePreview(trimmed),
    kind: "text",
    presentation: "plain",
  };
}
