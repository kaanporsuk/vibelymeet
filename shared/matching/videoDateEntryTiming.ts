export const VIDEO_DATE_ENTRY_STARTED_AT_DB_COLUMN = "entry_started_at" as const;
export const VIDEO_DATE_ENTRY_GRACE_EXPIRES_AT_DB_COLUMN = "entry_grace_expires_at" as const;

export type VideoDateEntryTimingSource = {
  entry_started_at?: string | null;
  entry_grace_expires_at?: string | null;
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
    entryStartedAtIso: source?.entry_started_at ?? null,
    entryGraceExpiresAtIso: source?.entry_grace_expires_at ?? null,
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
