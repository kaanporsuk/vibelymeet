export type BunnyVideoStatusNormalized =
  | "none"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "unknown";

export type CanonicalVibeVideoState =
  | "none"
  | "processing"
  | "stale_processing"
  | "ready"
  | "failed"
  | "error";

export interface CanonicalVibeVideoInfo {
  state: CanonicalVibeVideoState;
  uid: string | null;
  status: BunnyVideoStatusNormalized;
  statusUpdatedAt: string | null;
  statusAgeMs: number | null;
  isScoreEligible: boolean;
}

export const VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

const ALLOWED_BUNNY_VIDEO_STATUSES: ReadonlySet<string> = new Set([
  "none",
  "uploading",
  "processing",
  "ready",
  "failed",
]);

export function normalizeBunnyVideoUid(raw: string | null | undefined): string | null {
  return typeof raw === "string" ? raw.trim() || null : null;
}

export function normalizeBunnyVideoStatus(raw: string | null | undefined): BunnyVideoStatusNormalized {
  const s = String(raw ?? "none")
    .toLowerCase()
    .trim();
  if (!s || s === "null" || s === "undefined") return "none";
  if (s === "1" || s === "2") return "processing";
  if (s === "3" || s === "4") return "ready";
  if (s === "5") return "failed";
  if (ALLOWED_BUNNY_VIDEO_STATUSES.has(s)) return s as BunnyVideoStatusNormalized;
  return "unknown";
}

function parseStatusUpdatedAt(raw: string | number | Date | null | undefined): {
  iso: string | null;
  ms: number | null;
} {
  if (raw === null || raw === undefined || raw === "") return { iso: null, ms: null };

  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? { iso: raw.toISOString(), ms } : { iso: null, ms: null };
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { iso: new Date(raw).toISOString(), ms: raw } : { iso: null, ms: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { iso: null, ms: null };
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? { iso: new Date(ms).toISOString(), ms } : { iso: null, ms: null };
}

function parseNowMs(raw: string | number | Date | null | undefined): number {
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : Date.now();
  if (typeof raw === "string" && raw.trim()) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : Date.now();
  }
  return Date.now();
}

export function getVibeVideoStatusAgeMs(input: {
  bunnyVideoUpdatedAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
  now?: string | number | Date | null;
}): { statusUpdatedAt: string | null; statusAgeMs: number | null } {
  const parsed = parseStatusUpdatedAt(input.bunnyVideoUpdatedAt ?? input.updatedAt);
  if (parsed.ms === null) {
    return { statusUpdatedAt: parsed.iso, statusAgeMs: null };
  }

  const ageMs = Math.max(0, parseNowMs(input.now) - parsed.ms);
  return { statusUpdatedAt: parsed.iso, statusAgeMs: ageMs };
}

export function resolveCanonicalVibeVideoState(input: {
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
  bunnyVideoUpdatedAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
  now?: string | number | Date | null;
  staleProcessingThresholdMs?: number | null;
}): CanonicalVibeVideoInfo {
  const uid = normalizeBunnyVideoUid(input.bunnyVideoUid);
  const status = normalizeBunnyVideoStatus(input.bunnyVideoStatus);
  const { statusUpdatedAt, statusAgeMs } = getVibeVideoStatusAgeMs(input);
  const staleThresholdMs = Math.max(
    60_000,
    input.staleProcessingThresholdMs ?? VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS,
  );

  if (!uid) {
    return {
      state: status === "none" ? "none" : "error",
      uid: null,
      status,
      statusUpdatedAt,
      statusAgeMs,
      isScoreEligible: false,
    };
  }

  if (status === "ready") {
    return { state: "ready", uid, status, statusUpdatedAt, statusAgeMs, isScoreEligible: true };
  }

  if (status === "failed") {
    return { state: "failed", uid, status, statusUpdatedAt, statusAgeMs, isScoreEligible: true };
  }

  return {
    state: statusAgeMs !== null && statusAgeMs >= staleThresholdMs ? "stale_processing" : "processing",
    uid,
    status,
    statusUpdatedAt,
    statusAgeMs,
    isScoreEligible: true,
  };
}
