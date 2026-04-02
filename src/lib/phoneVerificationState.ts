import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await supabase
    .from("profiles")
    .select("phone_verified, phone_number")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { phone_verified?: boolean | null; phone_number?: string | null } | null;
  return {
    phoneVerified: !!row?.phone_verified,
    phoneNumber: (row?.phone_number as string | null | undefined) ?? null,
  };
}

