import {
  MESSAGE_KIND_VIBE_GAME,
  VIBE_GAME_ENVELOPE_VERSION,
  VIBE_GAME_SCHEMA,
} from "./constants";
import type {
  GameType,
  VibeGameEventPayload,
  VibeGameEventType,
  VibeGameMessageEnvelopeV1,
} from "./types";

export interface BuildEnvelopeInput {
  game_session_id: string;
  event_id: string;
  event_index: number;
  event_type: VibeGameEventType;
  game_type: GameType;
  actor_id: string;
  payload: VibeGameEventPayload;
  emitted_at?: string;
  client_request_id?: string;
}

export function buildVibeGameEnvelopeV1(input: BuildEnvelopeInput): VibeGameMessageEnvelopeV1 {
  const emitted_at = input.emitted_at ?? new Date().toISOString();
  return {
    schema: VIBE_GAME_SCHEMA,
    version: VIBE_GAME_ENVELOPE_VERSION,
    game_session_id: input.game_session_id,
    event_id: input.event_id,
    event_index: input.event_index,
    event_type: input.event_type,
    game_type: input.game_type,
    actor_id: input.actor_id,
    emitted_at,
    payload: input.payload,
    ...(input.client_request_id ? { client_request_id: input.client_request_id } : {}),
  };
}

/** Short stable row content for notifications / a11y (not authoritative). */
export function contentLabelForVibeGameEvent(
  game_type: GameType,
  event_type: VibeGameEventType
): string {
  const labels: Record<GameType, string> = {
    "2truths": "Two Truths",
    would_rather: "Would You Rather",
    charades: "Emoji Charades",
    scavenger: "Scavenger Hunt",
    roulette: "Vibe Roulette",
    intuition: "Intuition",
  };
  const g = labels[game_type];
  if (event_type === "session_start") return `🎮 ${g}`;
  if (event_type === "session_complete") return `🎮 ${g} · finished`;
  return `🎮 ${g} · update`;
}

export { MESSAGE_KIND_VIBE_GAME };
