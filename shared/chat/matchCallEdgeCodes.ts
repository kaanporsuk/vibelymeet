/** Error `code` values returned by `daily-room` for match calls (JSON body). */
export const MATCH_CALL_EDGE_CODES = {
  DUPLICATE_ACTIVE_CALL: "DUPLICATE_ACTIVE_CALL",
  TOKEN_ISSUE_FAILED: "TOKEN_ISSUE_FAILED",
} as const;

export type MatchCallEdgeCode = (typeof MATCH_CALL_EDGE_CODES)[keyof typeof MATCH_CALL_EDGE_CODES];

export function parseMatchCallEdgeCode(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export const MATCH_CALL_EDGE_MESSAGES: Record<string, string> = {
  [MATCH_CALL_EDGE_CODES.DUPLICATE_ACTIVE_CALL]: "A call is already in progress for this chat.",
  [MATCH_CALL_EDGE_CODES.TOKEN_ISSUE_FAILED]: "Could not connect — please try again in a moment.",
};

export function messageForMatchCallEdgeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return MATCH_CALL_EDGE_MESSAGES[code];
}
