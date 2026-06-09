export const VIDEO_DATE_ENTRY_STARTED_AT_DB_COLUMN = "handshake_started_at" as const;
export const VIDEO_DATE_ENTRY_GRACE_EXPIRES_AT_DB_COLUMN = "handshake_grace_expires_at" as const;

export type VideoDateEntryTimingSource = {
  handshake_started_at?: string | null;
  handshake_grace_expires_at?: string | null;
  date_started_at?: string | null;
};

export type VideoDateEntryTimingAliases = {
  entryStartedAtIso: string | null;
  entryGraceExpiresAtIso: string | null;
  dateStartedAtIso: string | null;
};

export function videoDateEntryTimingAliases(
  source: VideoDateEntryTimingSource | null | undefined,
): VideoDateEntryTimingAliases {
  return {
    entryStartedAtIso: source?.handshake_started_at ?? null,
    entryGraceExpiresAtIso: source?.handshake_grace_expires_at ?? null,
    dateStartedAtIso: source?.date_started_at ?? null,
  };
}

export function videoDateEntryStartedAtIso(
  source: VideoDateEntryTimingSource | null | undefined,
): string | null {
  return videoDateEntryTimingAliases(source).entryStartedAtIso;
}

export function videoDateEntryGraceExpiresAtIso(
  source: VideoDateEntryTimingSource | null | undefined,
): string | null {
  return videoDateEntryTimingAliases(source).entryGraceExpiresAtIso;
}
