/** Error `code` values returned by `daily-room` for match calls (JSON body). */
export const MATCH_CALL_EDGE_CODES = {
  ACCESS_DENIED: "ACCESS_DENIED",
  ARCHIVED_MATCH: "ARCHIVED_MATCH",
  CALL_NOT_ACTIVE: "CALL_NOT_ACTIVE",
  CALL_NOT_RINGING: "CALL_NOT_RINGING",
  DUPLICATE_ACTIVE_CALL: "DUPLICATE_ACTIVE_CALL",
  MISSING_CALL_ID: "MISSING_CALL_ID",
  NOT_FOUND: "NOT_FOUND",
  PARTICIPANT_PAUSED: "PARTICIPANT_PAUSED",
  PARTICIPANT_SUSPENDED: "PARTICIPANT_SUSPENDED",
  PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  TOKEN_ISSUE_FAILED: "TOKEN_ISSUE_FAILED",
  USERS_BLOCKED: "USERS_BLOCKED",
} as const;

export type MatchCallEdgeCode = (typeof MATCH_CALL_EDGE_CODES)[keyof typeof MATCH_CALL_EDGE_CODES];

export function parseMatchCallEdgeCode(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export const MATCH_CALL_EDGE_MESSAGES: Record<string, string> = {
  [MATCH_CALL_EDGE_CODES.ACCESS_DENIED]: "You can’t start a call in this chat.",
  [MATCH_CALL_EDGE_CODES.ARCHIVED_MATCH]: "Calls aren’t available for archived chats.",
  [MATCH_CALL_EDGE_CODES.CALL_NOT_ACTIVE]: "That call is no longer active.",
  [MATCH_CALL_EDGE_CODES.CALL_NOT_RINGING]: "That call is no longer ringing.",
  [MATCH_CALL_EDGE_CODES.DUPLICATE_ACTIVE_CALL]: "A call is already in progress for this chat.",
  [MATCH_CALL_EDGE_CODES.MISSING_CALL_ID]: "That call is no longer available.",
  [MATCH_CALL_EDGE_CODES.NOT_FOUND]: "That call is no longer available.",
  [MATCH_CALL_EDGE_CODES.PARTICIPANT_PAUSED]: "Calls aren’t available while an account is paused.",
  [MATCH_CALL_EDGE_CODES.PARTICIPANT_SUSPENDED]: "Calls aren’t available for this account right now.",
  [MATCH_CALL_EDGE_CODES.PROFILE_UNAVAILABLE]: "Calls aren’t available for this chat right now.",
  [MATCH_CALL_EDGE_CODES.TOKEN_ISSUE_FAILED]: "Could not connect — please try again in a moment.",
  [MATCH_CALL_EDGE_CODES.USERS_BLOCKED]: "Calls aren’t available for this chat.",
};

export function messageForMatchCallEdgeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return MATCH_CALL_EDGE_MESSAGES[code];
}
