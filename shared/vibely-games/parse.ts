import { asVibeGameEnvelopeV1, isVibeGameEnvelopeShape } from "./guards";
import type { VibeGameMessageEnvelopeV1 } from "./types";

/**
 * Parse structured_payload from DB (jsonb) into a typed envelope, or null.
 */
export function parseVibeGameEnvelopeFromStructuredPayload(
  structuredPayload: unknown
): VibeGameMessageEnvelopeV1 | null {
  if (structuredPayload === null || structuredPayload === undefined) return null;
  if (!isVibeGameEnvelopeShape(structuredPayload)) return null;
  return asVibeGameEnvelopeV1(structuredPayload as Record<string, unknown>);
}
