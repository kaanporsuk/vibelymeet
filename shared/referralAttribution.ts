import { normalizeReferralId, REFERRAL_STORAGE_KEY } from "./referrals";
import {
  buildReferralGrowthContext,
  type ReferralGrowthContext,
  type ReferralGrowthEventBody,
} from "./referralGrowthAttribution";

type MaybePromise<T> = T | Promise<T>;

export type ReferralStorage = {
  getItem: (key: string) => MaybePromise<string | null>;
  setItem: (key: string, value: string) => MaybePromise<void>;
  removeItem: (key: string) => MaybePromise<void>;
};

export type ReferralAttributionClient = {
  rpc: {
    (
      fn: "claim_growth_attribution",
      params: { p_referral_token: string; p_context: ReferralGrowthEventBody["context"] },
    ): PromiseLike<{ data: unknown; error: unknown | null }>;
    (
      fn: "apply_referral_attribution",
      params: { p_referrer_id: string },
    ): PromiseLike<{ data: unknown; error: unknown | null }>;
  };
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseAttributionPayload(
  data: unknown,
  referrerId: string,
): ApplyStoredReferralResult {
  const payload = asObject(data);
  const status = typeof payload?.status === "string" ? payload.status : null;
  const returnedReferrerId =
    typeof payload?.referrer_id === "string" ? normalizeReferralId(payload.referrer_id) : null;

  if (status === "already-set") {
    return { status: "already-set", referrerId: returnedReferrerId };
  }
  if (status === "applied") {
    return { status: "applied", referrerId };
  }
  if (status === "missing-profile") {
    return { status: "missing-profile", referrerId };
  }
  if (status === "self") {
    return { status: "self" };
  }
  if (status === "invalid") {
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

async function applyReferralThroughGrowthClaim(
  client: ReferralAttributionClient,
  referrerId: string,
  context: ReferralGrowthContext,
): Promise<ApplyStoredReferralResult | null> {
  try {
    const { data, error } = await client.rpc("claim_growth_attribution", {
      p_referral_token: referrerId,
      p_context: buildReferralGrowthContext(context),
    });

    if (error) {
      return null;
    }

    const payload = asObject(data);
    if (payload?.success === false) {
      const code = typeof payload.error === "string" ? payload.error : "";
      if (code === "UNAUTHENTICATED") return { status: "auth-required" };
      if (code === "VALIDATION_ERROR") return { status: "invalid" };
      return null;
    }

    const applied = payload?.applied_referral_result;
    if (!applied) return null;
    return parseAttributionPayload(applied, referrerId);
  } catch {
    return null;
  }
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
  context: ReferralGrowthContext = { platform: "web", surface: "auth_post_login" },
): Promise<ApplyStoredReferralResult> {
  const storedReferralId = await storage.getItem(REFERRAL_STORAGE_KEY);
  const referrerId = normalizeReferralId(storedReferralId);
  if (!referrerId) {
    await clearStoredReferralId(storage);
    return storedReferralId?.trim() ? { status: "invalid" } : { status: "no-pending" };
  }

  const currentUserReferralId = normalizeReferralId(currentUserId) ?? currentUserId;
  if (referrerId === currentUserReferralId) {
    await clearStoredReferralId(storage);
    return { status: "self" };
  }

  const claimed = await applyReferralThroughGrowthClaim(client, referrerId, context);
  if (claimed && claimed.status !== "rpc-failed") {
    if (
      claimed.status === "applied" ||
      claimed.status === "already-set" ||
      claimed.status === "invalid" ||
      claimed.status === "self"
    ) {
      await clearStoredReferralId(storage);
    }
    return claimed;
  }

  const { data, error } = await client.rpc("apply_referral_attribution", {
    p_referrer_id: referrerId,
  });
  if (error) {
    return { status: "rpc-failed", referrerId, message: asMessage(error) };
  }

  const parsed = parseAttributionPayload(data, referrerId);
  if (parsed.status === "already-set") {
    await clearStoredReferralId(storage);
    return parsed;
  }
  if (parsed.status === "applied") {
    await clearStoredReferralId(storage);
    return parsed;
  }
  if (parsed.status === "missing-profile") {
    return parsed;
  }
  if (parsed.status === "self") {
    await clearStoredReferralId(storage);
    return parsed;
  }
  if (parsed.status === "invalid") {
    await clearStoredReferralId(storage);
    return parsed;
  }
  if (parsed.status === "auth-required") {
    return parsed;
  }

  return parsed;
}
