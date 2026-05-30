// Synchronous, dependency-free redaction helpers for media Edge Function logs.
//
// Why: provider object paths embed an unguessable request token (`req-<token>`), and with the
// public-CDN exposure that token-bearing path is effectively bearer access material. We must not
// emit raw private media paths or full user IDs into application logs. These helpers mask the
// sensitive parts while preserving enough shape for debugging/correlation.

/**
 * Masks a media/provider path so it is safe to log:
 * - the unguessable `req-<token>` segment becomes `req-***`
 * - any embedded UUID segment (match id / user id in the path) becomes `<id>`
 * - query strings (signed tokens) are dropped
 */
export function redactMediaPath(path: string | null | undefined): string {
  if (typeof path !== "string" || !path) return "";
  let out = path.split(/[?#]/, 1)[0] ?? path;
  out = out.replace(/req-[A-Za-z0-9_.-]+/g, "req-***");
  out = out.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<id>");
  return out;
}

/** Truncates a stable id (user/match/message) for correlation without full exposure. */
export function maskId(id: string | null | undefined): string {
  if (typeof id !== "string" || !id) return "";
  return id.length <= 8 ? "***" : `${id.slice(0, 8)}…`;
}
