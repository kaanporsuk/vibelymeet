import { fetchMyProfileSettings } from "@/services/myProfileSettings";

export type PhoneVerificationProfile = {
  phoneVerified: boolean;
  phoneNumber: string | null;
};

/**
 * Canonical post-phone-verification refresh.
 *
 * Preserves backend truth model:
 * - `profiles.phone_verified` is the verified truth
 * - `profiles.phone_number` is the stored number (E.164)
 */
export async function fetchMyPhoneVerificationProfile(userId: string): Promise<PhoneVerificationProfile> {
  const row = await fetchMyProfileSettings();
  if (row?.id && row.id !== userId) throw new Error("Profile settings user mismatch");
  return {
    phoneVerified: !!row?.phone_verified,
    phoneNumber: row?.phone_number ?? null,
  };
}
