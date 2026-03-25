/** Canonical schema id for structured_payload JSON. */
export const VIBE_GAME_SCHEMA = "vibely.game_event" as const;

/** Envelope version; bump only for breaking envelope changes. */
export const VIBE_GAME_ENVELOPE_VERSION = 1 as const;

/** Persisted on messages.message_kind */
export const MESSAGE_KIND_VIBE_GAME = "vibe_game" as const;

export const MAX_STATEMENT_LEN = 200;
export const MAX_OPTION_LEN = 300;
export const MAX_PROMPT_LEN = 300;
export const MAX_ANSWER_LEN = 500;
export const MAX_GUESS_LEN = 500;
export const MAX_QUESTION_LEN = 400;
export const MAX_EMOJI_STRING_LEN = 120;
export const MAX_URL_LEN = 2048;
export const MAX_GAME_SESSION_ID_LEN = 64;
