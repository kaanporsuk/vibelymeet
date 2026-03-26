import { MESSAGE_KIND_VIBE_GAME, VIBE_GAME_ENVELOPE_VERSION, VIBE_GAME_SCHEMA } from "./constants";
import type { GameType, VibeGameMessageEnvelopeV1 } from "./types";

const GAME_TYPES: ReadonlySet<string> = new Set([
  "2truths",
  "would_rather",
  "charades",
  "scavenger",
  "roulette",
  "intuition",
]);

export function isSupportedGameType(v: unknown): v is GameType {
  return typeof v === "string" && GAME_TYPES.has(v);
}

export function isVibeGameMessageKind(kind: unknown): boolean {
  return kind === MESSAGE_KIND_VIBE_GAME;
}

export function isVibeGameEnvelopeShape(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schema === VIBE_GAME_SCHEMA &&
    o.version === VIBE_GAME_ENVELOPE_VERSION &&
    typeof o.game_session_id === "string" &&
    typeof o.event_id === "string" &&
    typeof o.event_index === "number" &&
    typeof o.event_type === "string" &&
    isSupportedGameType(o.game_type) &&
    typeof o.actor_id === "string" &&
    typeof o.emitted_at === "string" &&
    o.payload !== null &&
    typeof o.payload === "object"
  );
}

/** Narrow after isVibeGameEnvelopeShape + field validation */
export function asVibeGameEnvelopeV1(v: Record<string, unknown>): VibeGameMessageEnvelopeV1 | null {
  if (!isVibeGameEnvelopeShape(v)) return null;
  return v as unknown as VibeGameMessageEnvelopeV1;
}
