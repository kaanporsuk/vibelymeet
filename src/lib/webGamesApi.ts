import { supabase } from "@/integrations/supabase/client";
import { parseVibeGameEnvelopeFromStructuredPayload } from "../../shared/vibely-games/parse";
import type { GameType, VibeGameMessageEnvelopeV1 } from "../../shared/vibely-games/types";

export type ClientVibeGameEventType =
  | "session_start"
  | "two_truths_guess"
  | "would_rather_vote"
  | "charades_guess"
  | "scavenger_photo"
  | "roulette_answer"
  | "intuition_result";

export type SendGameEventInput = {
  match_id: string;
  game_session_id: string;
  event_index: number;
  event_type: ClientVibeGameEventType;
  game_type: GameType;
  payload: Record<string, unknown>;
  client_request_id?: string;
};

export type GameEventMessageRow = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  message_kind: string;
  structured_payload: Record<string, unknown>;
  envelope: VibeGameMessageEnvelopeV1 | null;
};

export type SendGameEventError =
  | { kind: "rejection"; code: string; expectedEventIndex?: number }
  | { kind: "transport"; code: "unauthorized" | "network" | "unknown"; message: string };

export type SendGameEventResult =
  | { ok: true; idempotent: boolean; messages: GameEventMessageRow[] }
  | { ok: false; error: SendGameEventError };

function randomUuidV4(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    return (ch === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

export function newVibeGameSessionId(): string {
  return randomUuidV4();
}

function mapRawRow(raw: unknown): GameEventMessageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const match_id = typeof r.match_id === "string" ? r.match_id : null;
  const sender_id = typeof r.sender_id === "string" ? r.sender_id : null;
  const content = typeof r.content === "string" ? r.content : null;
  const created_at = typeof r.created_at === "string" ? r.created_at : null;
  if (!id || !match_id || !sender_id || !content || !created_at) return null;
  const message_kind = typeof r.message_kind === "string" ? r.message_kind : "text";
  const structured_payload =
    r.structured_payload && typeof r.structured_payload === "object" && !Array.isArray(r.structured_payload)
      ? (r.structured_payload as Record<string, unknown>)
      : {};
  return {
    id,
    match_id,
    sender_id,
    content,
    created_at,
    message_kind,
    structured_payload,
    envelope:
      message_kind === "vibe_game" ? parseVibeGameEnvelopeFromStructuredPayload(structured_payload) : null,
  };
}

export async function sendGameEvent(input: SendGameEventInput): Promise<SendGameEventResult> {
  const clientRequestId = input.client_request_id?.trim() || randomUuidV4();
  const { data, error } = await supabase.functions.invoke("send-game-event", {
    body: {
      ...input,
      client_request_id: clientRequestId,
    },
    headers: { "x-client-request-id": clientRequestId },
  });

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return {
      ok: false,
      error: {
        kind: "transport",
        code: status === 401 ? "unauthorized" : "network",
        message: error.message || "Network error",
      },
    };
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: { kind: "transport", code: "unknown", message: "Invalid server response" } };
  }

  if (payload.success === true) {
    const rows: unknown[] = Array.isArray(payload.messages)
      ? payload.messages
      : payload.message !== undefined
        ? [payload.message]
        : [];
    return {
      ok: true,
      idempotent: payload.idempotent === true,
      messages: rows.map(mapRawRow).filter((m): m is GameEventMessageRow => m !== null),
    };
  }

  return {
    ok: false,
    error: {
      kind: "rejection",
      code: typeof payload.error === "string" ? payload.error : "unknown",
      expectedEventIndex: typeof payload.expected === "number" ? payload.expected : undefined,
    },
  };
}

export function formatSendGameEventError(err: SendGameEventError): string {
  if (err.kind === "transport") return err.message;
  if (err.code === "event_index_out_of_order") return "Out of sync with the server. Refresh and try again.";
  if (err.code === "partner_event_required") return "Not your turn yet.";
  if (err.code === "session_already_complete") return "This game round is already complete.";
  return "Could not save this game action.";
}
