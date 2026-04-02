export type PhotoVerificationState = "none" | "pending" | "approved" | "rejected" | "expired";

export type LatestPhotoVerificationStatus = "pending" | "approved" | "rejected" | null | undefined;

type ResolvePhotoVerificationStateParams = {
  /**
   * Current profile truth: `profiles.photo_verified`.
   * In this product model, admin sets this to true; client never auto-approves.
   */
  photoVerified: boolean | null | undefined;
  /**
   * Current profile expiry timestamp: `profiles.photo_verification_expires_at`.
   * Used only when `photoVerified` is true.
   */
  photoVerificationExpiresAt: string | null | undefined;
  /**
   * Latest verification row status: `photo_verifications.status`.
   * Used only when `photoVerified` is not true.
   */
  latestPhotoVerificationStatus: LatestPhotoVerificationStatus;
};

/**
 * Canonical resolver for web photo verification UI state.
 *
 * Truth model:
 * - approved vs expired: `profiles.photo_verified` + `profiles.photo_verification_expires_at`
 * - pending vs rejected: latest `photo_verifications.status` when `profiles.photo_verified` is not true
 * - none: no pending/rejected row (or any other status not expected by the UI)
 */
export function resolvePhotoVerificationState({
  photoVerified,
  photoVerificationExpiresAt,
  latestPhotoVerificationStatus,
}: ResolvePhotoVerificationStateParams): PhotoVerificationState {
  if (photoVerified) {
    if (photoVerificationExpiresAt && new Date(photoVerificationExpiresAt) < new Date()) return "expired";
    return "approved";
  }

  if (latestPhotoVerificationStatus === "pending") return "pending";
  if (latestPhotoVerificationStatus === "rejected") return "rejected";
  return "none";
}

