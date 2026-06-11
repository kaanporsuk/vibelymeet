export const VIDEO_DATE_ENTRY_PHASE = "entry" as const;
const LEGACY_VIDEO_DATE_ENTRY_PHASE = "handshake" as const;

export type VideoDateEntryPhaseValue = typeof VIDEO_DATE_ENTRY_PHASE;

export const LEGACY_VIDEO_DATE_ENTRY_TIMEOUT_REASON = "handshake_timeout" as const;
export const LEGACY_VIDEO_DATE_ENTRY_GRACE_EXPIRED_REASON = "handshake_grace_expired" as const;

export function normalizeVideoDateEntryPhase(value: unknown): string | null {
  if (value === LEGACY_VIDEO_DATE_ENTRY_PHASE || value === VIDEO_DATE_ENTRY_PHASE) {
    return VIDEO_DATE_ENTRY_PHASE;
  }
  return typeof value === "string" ? value : null;
}

export function isVideoDateEntryPhase(value: unknown): boolean {
  return normalizeVideoDateEntryPhase(value) === VIDEO_DATE_ENTRY_PHASE;
}
