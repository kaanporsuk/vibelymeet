export const REFERRAL_STORAGE_KEY = "vibely_referrer_id";

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeReferralId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || !UUID_LIKE_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

export function readReferralIdFromSearchParams(searchParams: URLSearchParams): string | null {
  return normalizeReferralId(searchParams.get("ref"));
}

export function readReferralIdFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return readReferralIdFromSearchParams(parsed.searchParams);
  } catch {
    return null;
  }
}
