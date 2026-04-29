export type BunnyVideoStatusNormalized =
  | "none"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "unknown";

export type CanonicalVibeVideoState = "none" | "processing" | "ready" | "failed" | "error";

export interface CanonicalVibeVideoInfo {
  state: CanonicalVibeVideoState;
  uid: string | null;
  status: BunnyVideoStatusNormalized;
  isScoreEligible: boolean;
}

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

export function resolveCanonicalVibeVideoState(input: {
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
}): CanonicalVibeVideoInfo {
  const uid = normalizeBunnyVideoUid(input.bunnyVideoUid);
  const status = normalizeBunnyVideoStatus(input.bunnyVideoStatus);

  if (!uid) {
    return {
      state: status === "none" ? "none" : "error",
      uid: null,
      status,
      isScoreEligible: false,
    };
  }

  if (status === "ready") {
    return { state: "ready", uid, status, isScoreEligible: true };
  }

  if (status === "failed") {
    return { state: "failed", uid, status, isScoreEligible: true };
  }

  return { state: "processing", uid, status, isScoreEligible: true };
}

