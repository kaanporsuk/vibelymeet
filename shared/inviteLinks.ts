import { normalizeReferralId } from "./referrals";

export const VIBELY_WEB_ORIGIN = "https://vibelymeet.com";

/**
 * Public event page URL. Adds `?ref=` when `referrerUserId` is a UUID-like auth user id.
 * Does not duplicate `ref` if callers pass a pre-built URL through {@link withReferralParam}.
 */
export function buildEventShareUrl(
  eventId: string,
  referrerUserId: string | null | undefined,
): string {
  const id = eventId.trim();
  if (!id) return `${VIBELY_WEB_ORIGIN}/events`;
  const path = `/events/${encodeURIComponent(id)}`;
  const ref = normalizeReferralId(referrerUserId);
  if (!ref) {
    return `${VIBELY_WEB_ORIGIN}${path}`;
  }
  return `${VIBELY_WEB_ORIGIN}${path}?ref=${encodeURIComponent(ref)}`;
}

/** Marketing invite URL → `/auth?ref=` after InviteRedirect. */
export function buildInviteLandingUrl(referrerUserId: string | null | undefined): string {
  const ref = normalizeReferralId(referrerUserId);
  if (!ref) {
    return `${VIBELY_WEB_ORIGIN}/invite`;
  }
  return `${VIBELY_WEB_ORIGIN}/invite?ref=${encodeURIComponent(ref)}`;
}

/**
 * Parse `url` and set `ref` (overwrites existing `ref`). Use for fixing arbitrary current URLs.
 */
export function withReferralParam(
  url: string,
  referrerUserId: string | null | undefined,
): string {
  const ref = normalizeReferralId(referrerUserId);
  if (!ref) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("ref", ref);
    return parsed.toString();
  } catch {
    return url;
  }
}
