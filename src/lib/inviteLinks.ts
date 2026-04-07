/**
 * Canonical HTTPS invite/event URLs for sharing. `ref` is the referrer's auth user id (UUID).
 * Matches native InviteFriendsSheet and /invite → /auth?ref= flow.
 */
export const VIBELY_WEB_ORIGIN = "https://vibelymeet.com";

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * Public event page URL. Adds `?ref=` when `referrerUserId` is a non-empty UUID-like string.
 * Does not duplicate `ref` if callers pass a pre-built URL through {@link withReferralParam} instead.
 */
export function buildEventShareUrl(eventId: string, referrerUserId: string | null | undefined): string {
  const id = eventId.trim();
  if (!id) return `${VIBELY_WEB_ORIGIN}/events`;
  const path = `/events/${encodeURIComponent(id)}`;
  const ref = referrerUserId?.trim();
  if (!ref || !isUuidLike(ref)) {
    return `${VIBELY_WEB_ORIGIN}${path}`;
  }
  return `${VIBELY_WEB_ORIGIN}${path}?ref=${encodeURIComponent(ref)}`;
}

/** Marketing invite URL → `/auth?ref=` after InviteRedirect. */
export function buildInviteLandingUrl(referrerUserId: string | null | undefined): string {
  const ref = referrerUserId?.trim();
  if (!ref || !isUuidLike(ref)) {
    return `${VIBELY_WEB_ORIGIN}/invite`;
  }
  return `${VIBELY_WEB_ORIGIN}/invite?ref=${encodeURIComponent(ref)}`;
}

/**
 * Parse `url` and set `ref` (overwrites existing `ref`). Use for fixing arbitrary current URLs.
 */
export function withReferralParam(url: string, referrerUserId: string | null | undefined): string {
  const ref = referrerUserId?.trim();
  if (!ref || !isUuidLike(ref)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("ref", ref);
    return u.toString();
  } catch {
    return url;
  }
}
