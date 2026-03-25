import { VIBE_GAME_ENVELOPE_VERSION, VIBE_GAME_SCHEMA } from "./constants";

/** Supported arcade games (aligned with legacy web catalog). */
export type GameType =
  | "2truths"
  | "would_rather"
  | "charades"
  | "scavenger"
  | "roulette"
  | "intuition";

export type VibeGameEventType =
  | "session_start"
  | "two_truths_guess"
  | "would_rather_vote"
  | "charades_guess"
  | "scavenger_photo"
  | "roulette_answer"
  | "intuition_result"
  | "session_complete";

/** Per-event payload discriminated by event_type + game_type rules (validated server + client). */
export type VibeGameEventPayload =
  | TwoTruthsSessionStartPayload
  | TwoTruthsGuessPayload
  | WouldRatherSessionStartPayload
  | WouldRatherVotePayload
  | CharadesSessionStartPayload
  | CharadesGuessPayload
  | ScavengerSessionStartPayload
  | ScavengerPhotoPayload
  | RouletteSessionStartPayload
  | RouletteAnswerPayload
  | IntuitionSessionStartPayload
  | IntuitionResultPayload
  | SessionCompletePayload;

export interface TwoTruthsSessionStartPayload {
  statements: [string, string, string];
  lie_index: 0 | 1 | 2;
}

export interface TwoTruthsGuessPayload {
  guess_index: 0 | 1 | 2;
}

export interface WouldRatherSessionStartPayload {
  option_a: string;
  option_b: string;
  sender_vote: "A" | "B";
}

export interface WouldRatherVotePayload {
  receiver_vote: "A" | "B";
}

export interface CharadesSessionStartPayload {
  answer: string;
  emojis: string[];
}

export interface CharadesGuessPayload {
  guess: string;
}

export interface ScavengerSessionStartPayload {
  prompt: string;
  sender_photo_url: string;
}

export interface ScavengerPhotoPayload {
  receiver_photo_url: string;
}

export interface RouletteSessionStartPayload {
  question: string;
  sender_answer: string;
}

export interface RouletteAnswerPayload {
  receiver_answer: string;
}

export interface IntuitionSessionStartPayload {
  options: [string, string];
  sender_choice: 0 | 1;
}

export interface IntuitionResultPayload {
  result: "correct" | "wrong";
}

/** Emitted by server when rules satisfied (optional hint for UI). */
export interface SessionCompletePayload {
  /** Short machine-readable reason, e.g. charades_correct */
  reason?: string;
}

/**
 * Canonical persisted envelope (stored in messages.structured_payload).
 * messages.match_id, messages.sender_id, messages.content, messages.message_kind are table columns.
 */
export interface VibeGameMessageEnvelopeV1 {
  schema: typeof VIBE_GAME_SCHEMA;
  version: typeof VIBE_GAME_ENVELOPE_VERSION;
  game_session_id: string;
  /** Same as messages.id when inserted with explicit id */
  event_id: string;
  event_index: number;
  event_type: VibeGameEventType;
  game_type: GameType;
  /** Must equal messages.sender_id for the row */
  actor_id: string;
  emitted_at: string;
  payload: VibeGameEventPayload;
  /** Optional client idempotency token (echoed for debugging) */
  client_request_id?: string;
}

/** Folded view for one session — used when rendering a single bubble. */
export type VibeGameSnapshotV1 =
  | TwoTruthsSnapshot
  | WouldRatherSnapshot
  | CharadesSnapshot
  | ScavengerSnapshot
  | RouletteSnapshot
  | IntuitionSnapshot
  | EmptySnapshot;

export interface EmptySnapshot {
  game_type: null;
  status: "empty";
}

export interface TwoTruthsSnapshot {
  game_type: "2truths";
  status: "active" | "complete";
  statements: [string, string, string];
  lie_index: 0 | 1 | 2;
  guessed_index?: 0 | 1 | 2;
  is_correct?: boolean;
}

export interface WouldRatherSnapshot {
  game_type: "would_rather";
  status: "active" | "complete";
  option_a: string;
  option_b: string;
  sender_vote: "A" | "B";
  receiver_vote?: "A" | "B";
  is_match?: boolean;
}

export interface CharadesSnapshot {
  game_type: "charades";
  status: "active" | "complete";
  answer: string;
  emojis: string[];
  guesses: string[];
  is_guessed?: boolean;
}

export interface ScavengerSnapshot {
  game_type: "scavenger";
  status: "active" | "complete";
  prompt: string;
  sender_photo_url: string;
  receiver_photo_url?: string;
  is_unlocked?: boolean;
}

export interface RouletteSnapshot {
  game_type: "roulette";
  status: "active" | "complete";
  question: string;
  sender_answer: string;
  receiver_answer?: string;
  is_unlocked?: boolean;
}

export interface IntuitionSnapshot {
  game_type: "intuition";
  status: "active" | "complete";
  options: [string, string];
  sender_choice: 0 | 1;
  receiver_result?: "correct" | "wrong";
}

export interface VibeGameFoldResult {
  snapshot: VibeGameSnapshotV1;
  /** Non-fatal warnings from fold (e.g. unexpected ordering) */
  warnings: string[];
}
