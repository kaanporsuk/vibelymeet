import { normalizeReferralId, REFERRAL_STORAGE_KEY } from "./referrals";

type MaybePromise<T> = T | Promise<T>;

export type ReferralStorage = {
  getItem: (key: string) => MaybePromise<string | null>;
  setItem: (key: string, value: string) => MaybePromise<void>;
  removeItem: (key: string) => MaybePromise<void>;
};

export type ReferralAttributionClient = {
  rpc: (
    fn: "apply_referral_attribution",
    params: { p_referrer_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown | null }>;
};

export type ApplyStoredReferralResult =
  | { status: "no-pending" }
  | { status: "invalid" }
  | { status: "self" }
  | { status: "auth-required" }
  | { status: "already-set"; referrerId: string | null }
  | { status: "missing-profile"; referrerId: string }
  | { status: "rpc-failed"; referrerId: string; message: string }
  | { status: "applied"; referrerId: string };

function asMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected referral attribution failure.";
}

export async function getStoredReferralId(storage: ReferralStorage): Promise<string | null> {
  const stored = await storage.getItem(REFERRAL_STORAGE_KEY);
  return normalizeReferralId(stored);
}

export async function storeReferralId(
  storage: ReferralStorage,
  referralId: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeReferralId(referralId);
  if (!normalized) {
    return null;
  }
  await storage.setItem(REFERRAL_STORAGE_KEY, normalized);
  return normalized;
}

export async function clearStoredReferralId(storage: ReferralStorage): Promise<void> {
  await storage.removeItem(REFERRAL_STORAGE_KEY);
}

export async function applyStoredReferralAttribution(
  client: ReferralAttributionClient,
  storage: ReferralStorage,
  currentUserId: string,
): Promise<ApplyStoredReferralResult> {
  const referrerId = await getStoredReferralId(storage);
  if (!referrerId) {
    await clearStoredReferralId(storage);
    return { status: "no-pending" };
  }

  if (referrerId === currentUserId) {
    await clearStoredReferralId(storage);
    return { status: "self" };
  }

  const { data, error } = await client.rpc("apply_referral_attribution", {
    p_referrer_id: referrerId,
  });
  if (error) {
    return { status: "rpc-failed", referrerId, message: asMessage(error) };
  }

  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const status = typeof payload?.status === "string" ? payload.status : null;
  const returnedReferrerId =
    typeof payload?.referrer_id === "string" ? normalizeReferralId(payload.referrer_id) : null;

  if (status === "already-set") {
    await clearStoredReferralId(storage);
    return { status: "already-set", referrerId: returnedReferrerId };
  }
  if (status === "applied") {
    await clearStoredReferralId(storage);
    return { status: "applied", referrerId };
  }
  if (status === "missing-profile") {
    return { status: "missing-profile", referrerId };
  }
  if (status === "self") {
    await clearStoredReferralId(storage);
    return { status: "self" };
  }
  if (status === "invalid") {
    await clearStoredReferralId(storage);
    return { status: "invalid" };
  }
  if (status === "auth-required") {
    return { status: "auth-required" };
  }

  return {
    status: "rpc-failed",
    referrerId,
    message: "Unexpected referral attribution response.",
  };
}
