import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import {
  applyStoredReferralAttribution,
  storeReferralId,
  type ApplyStoredReferralResult,
  type ReferralStorage,
} from "../../../shared/referralAttribution";
import { readReferralIdFromUrl } from "../../../shared/referrals";

const nativeReferralStorage: ReferralStorage = {
  getItem(key: string) {
    return AsyncStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    return AsyncStorage.setItem(key, value);
  },
  removeItem(key: string) {
    return AsyncStorage.removeItem(key);
  },
};

export async function captureNativeReferral(url: string | null | undefined): Promise<string | null> {
  const referralId = readReferralIdFromUrl(url);
  if (!referralId) {
    return null;
  }
  await storeReferralId(nativeReferralStorage, referralId);
  return referralId;
}

export async function applyNativeReferralAttribution(
  userId: string,
): Promise<ApplyStoredReferralResult> {
  return applyStoredReferralAttribution(
    supabase as unknown as Parameters<typeof applyStoredReferralAttribution>[0],
    nativeReferralStorage,
    userId,
  );
}
