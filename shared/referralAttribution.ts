import { normalizeReferralId, REFERRAL_STORAGE_KEY } from "./referrals";

type MaybePromise<T> = T | Promise<T>;

export type ReferralStorage = {
  getItem: (key: string) => MaybePromise<string | null>;
  setItem: (key: string, value: string) => MaybePromise<void>;
  removeItem: (key: string) => MaybePromise<void>;
};

type ReferralProfileRow = {
  id: string;
  referred_by: string | null;
};

type ReferralSelectBuilder = {
  eq: (
    column: string,
    value: string,
  ) => {
    maybeSingle: () => PromiseLike<{ data: ReferralProfileRow | null; error: unknown | null }>;
  };
};

type ReferralUpdateBuilder = {
  eq: (column: string, value: string) => PromiseLike<{ error: unknown | null }>;
};

type ReferralProfilesTable = {
  select: (columns: string) => ReferralSelectBuilder;
  update: (values: { referred_by: string }) => ReferralUpdateBuilder;
};

export type ReferralAttributionClient = {
  from: (table: "profiles") => ReferralProfilesTable;
};

export type ApplyStoredReferralResult =
  | { status: "no-pending" }
  | { status: "invalid" }
  | { status: "self" }
  | { status: "already-set"; referrerId: string | null }
  | { status: "missing-profile"; referrerId: string }
  | { status: "lookup-failed"; referrerId: string; message: string }
  | { status: "update-failed"; referrerId: string; message: string }
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

  const { data, error } = await client
    .from("profiles")
    .select("id, referred_by")
    .eq("id", currentUserId)
    .maybeSingle();

  if (error) {
    return { status: "lookup-failed", referrerId, message: asMessage(error) };
  }

  if (!data) {
    return { status: "missing-profile", referrerId };
  }

  if (data.referred_by) {
    await clearStoredReferralId(storage);
    return { status: "already-set", referrerId: data.referred_by };
  }

  const { error: updateError } = await client
    .from("profiles")
    .update({ referred_by: referrerId })
    .eq("id", currentUserId);

  if (updateError) {
    return { status: "update-failed", referrerId, message: asMessage(updateError) };
  }

  await clearStoredReferralId(storage);
  return { status: "applied", referrerId };
}
