export type AuthIdentityLike = {
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
};

export type UserLikeForCanonicalEmail = {
  email?: string | null;
  identities?: AuthIdentityLike[] | null;
};

export function normalizeEmailAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Prefer auth.users.email; otherwise take email from linked identities (Apple/Google/email).
 * Does not use profiles.* — only auth/provider identity data.
 */
export function resolveCanonicalAuthEmail(user: UserLikeForCanonicalEmail | null | undefined): string | null {
  if (!user) return null;
  const direct = normalizeEmailAddress(user.email);
  if (direct) return direct;
  const list = user.identities ?? [];
  const preferredOrder = ["apple", "google", "email"];
  for (const provider of preferredOrder) {
    const id = list.find((i) => i.provider === provider);
    const raw = id?.identity_data?.email;
    if (typeof raw === "string") {
      const n = normalizeEmailAddress(raw);
      if (n) return n;
    }
  }
  for (const id of list) {
    const raw = id?.identity_data?.email;
    if (typeof raw === "string") {
      const n = normalizeEmailAddress(raw);
      if (n) return n;
    }
  }
  return null;
}

/**
 * Canonical "email verified" meaning for Vibely trust UI:
 * the currently signed-in account email matches the profile email that was
 * confirmed through the in-app verification flow.
 *
 * `profiles.email_verified` / `verified_email` are only written by the email-verification
 * Edge Function after a successful OTP; matching auth email is sufficient to show the badge.
 */
export function isCurrentEmailVerified(params: {
  emailVerified: boolean | null | undefined;
  verifiedEmail: string | null | undefined;
  authEmail: string | null | undefined;
}): boolean {
  if (params.emailVerified !== true) return false;
  const verifiedEmail = normalizeEmailAddress(params.verifiedEmail);
  const authEmail = normalizeEmailAddress(params.authEmail);
  return !!verifiedEmail && !!authEmail && verifiedEmail === authEmail;
}
