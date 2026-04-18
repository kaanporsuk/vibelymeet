/**
 * Error `code` values returned by `daily-room` for match calls (JSON body).
 * Web and native both branch on these; keep in sync with server responses in
 * `supabase/functions/daily-room/index.ts`.
 */
export const MATCH_CALL_EDGE_CODES = {
  // Create-phase prechecks (daily-room/create_match_call)
  ARCHIVED_MATCH: "ARCHIVED_MATCH",
  DUPLICATE_ACTIVE_CALL: "DUPLICATE_ACTIVE_CALL",
  USERS_BLOCKED: "USERS_BLOCKED",
  PARTICIPANT_SUSPENDED: "PARTICIPANT_SUSPENDED",
  PARTICIPANT_PAUSED: "PARTICIPANT_PAUSED",
  PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  ACCESS_DENIED: "ACCESS_DENIED",
  // Answer-phase (daily-room/answer_match_call)
  CALL_NOT_RINGING: "CALL_NOT_RINGING",
  NOT_FOUND: "NOT_FOUND",
  TOKEN_ISSUE_FAILED: "TOKEN_ISSUE_FAILED",
  // Input validation (daily-room — any action)
  MISSING_MATCH_ID: "MISSING_MATCH_ID",
  MISSING_CALL_ID: "MISSING_CALL_ID",
  MISSING_ROOM_NAME: "MISSING_ROOM_NAME",
  // Generic / transport
  UNAUTHORIZED: "UNAUTHORIZED",
  DAILY_PROVIDER_ERROR: "DAILY_PROVIDER_ERROR",
} as const;

export type MatchCallEdgeCode = (typeof MATCH_CALL_EDGE_CODES)[keyof typeof MATCH_CALL_EDGE_CODES];

export function parseMatchCallEdgeCode(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * User-facing message for a given edge code. Only codes that product wants to surface
 * differently from a generic fallback are listed; all others should fall through to the
 * caller's generic copy (e.g. "Couldn't start call").
 */
export const MATCH_CALL_EDGE_MESSAGES: Record<string, string> = {
  [MATCH_CALL_EDGE_CODES.ARCHIVED_MATCH]: "This chat is archived — unarchive it to start a call.",
  [MATCH_CALL_EDGE_CODES.DUPLICATE_ACTIVE_CALL]: "A call is already in progress for this chat.",
  [MATCH_CALL_EDGE_CODES.USERS_BLOCKED]: "You can't call this person right now.",
  [MATCH_CALL_EDGE_CODES.PARTICIPANT_SUSPENDED]: "This account isn't available for calls right now.",
  [MATCH_CALL_EDGE_CODES.PARTICIPANT_PAUSED]: "This account is paused. Try again later.",
  [MATCH_CALL_EDGE_CODES.CALL_NOT_RINGING]: "This call is no longer ringing.",
  [MATCH_CALL_EDGE_CODES.TOKEN_ISSUE_FAILED]: "Could not connect — please try again in a moment.",
};

export function messageForMatchCallEdgeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return MATCH_CALL_EDGE_MESSAGES[code];
}
