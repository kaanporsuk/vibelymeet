import { supabase } from "@/integrations/supabase/client";
import {
  applyStoredReferralAttribution,
  storeReferralId,
  type ApplyStoredReferralResult,
  type ReferralStorage,
} from "../../shared/referralAttribution";
import { readReferralIdFromSearchParams } from "../../shared/referrals";

const browserReferralStorage: ReferralStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

export function captureBrowserReferral(searchParams: URLSearchParams): string | null {
  const referralId = readReferralIdFromSearchParams(searchParams);
  if (!referralId) {
    return null;
  }
  void storeReferralId(browserReferralStorage, referralId);
  return referralId;
}

export async function applyBrowserReferralAttribution(
  userId: string,
): Promise<ApplyStoredReferralResult> {
  return applyStoredReferralAttribution(
    supabase as unknown as Parameters<typeof applyStoredReferralAttribution>[0],
    browserReferralStorage,
    userId,
  );
}
