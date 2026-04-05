export function normalizeEmailAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Canonical "email verified" meaning for Vibely trust UI:
 * the currently signed-in account email matches the profile email that was
 * confirmed through the in-app verification flow.
 */
export function isCurrentEmailVerified(params: {
  emailVerified: boolean | null | undefined;
  verifiedEmail: string | null | undefined;
  authEmail: string | null | undefined;
  authEmailConfirmed?: boolean | null | undefined;
}): boolean {
  if (params.emailVerified !== true) return false;
  if (params.authEmailConfirmed === false) return false;
  const verifiedEmail = normalizeEmailAddress(params.verifiedEmail);
  const authEmail = normalizeEmailAddress(params.authEmail);
  return !!verifiedEmail && !!authEmail && verifiedEmail === authEmail;
}
