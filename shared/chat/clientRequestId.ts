/**
 * Extract `structured_payload.client_request_id` for outbox/server dedupe (web + native thread merge).
 * Keep aligned with `src/pages/Chat.tsx` merge behavior.
 */
export function clientRequestIdFromStructured(
  p: Record<string, unknown> | null | undefined,
): string | null {
  if (!p || typeof p !== "object") return null;
  const id = (p as { client_request_id?: unknown }).client_request_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
