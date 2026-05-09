import test from "node:test";
import assert from "node:assert/strict";
import { buildEventShareUrl, buildInviteLandingUrl } from "./inviteLinks";
import {
  applyStoredReferralAttribution,
  storeReferralId,
  type ReferralAttributionClient,
  type ReferralStorage,
} from "./referralAttribution";
import {
  buildReferralGrowthEventBody,
  recordInviteLandingGrowth,
  type ReferralGrowthFunctionClient,
} from "./referralGrowthAttribution";
import { normalizeReferralId, REFERRAL_STORAGE_KEY } from "./referrals";

const REFERRER_ID = "2cf4a5af-acc7-4450-899d-0c7dc85139e2";
const CURRENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REFERRER_ID = "33333333-3333-4333-8333-333333333333";

function createStorage(): { storage: ReferralStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
  };
}

function createClient(
  handler: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>,
): ReferralAttributionClient {
  return {
    rpc: ((fn: string, params: Record<string, unknown>) => handler(fn, params)) as ReferralAttributionClient["rpc"],
  };
}

test("normalizes UUID-like referral ids only", () => {
  assert.equal(normalizeReferralId(` ${REFERRER_ID} `), REFERRER_ID);
  assert.equal(normalizeReferralId(REFERRER_ID.toUpperCase()), REFERRER_ID);
  assert.equal(normalizeReferralId("not-a-referral"), null);
  assert.equal(normalizeReferralId(""), null);
  assert.equal(normalizeReferralId(null), null);
});

test("builds canonical invite and event share URLs", () => {
  assert.equal(
    buildInviteLandingUrl(REFERRER_ID),
    `https://www.vibelymeet.com/invite?ref=${REFERRER_ID}`,
  );
  assert.equal(buildInviteLandingUrl("bad"), "https://www.vibelymeet.com/invite");
  assert.equal(
    buildEventShareUrl("event/with space", REFERRER_ID),
    `https://www.vibelymeet.com/events/event%2Fwith%20space?ref=${REFERRER_ID}`,
  );
  assert.equal(buildEventShareUrl("", REFERRER_ID), "https://www.vibelymeet.com/events");
});

test("records invite landing and invite click through the growth wrapper", async () => {
  const calls: unknown[] = [];
  const client: ReferralGrowthFunctionClient = {
    functions: {
      async invoke(_fn, options) {
        calls.push(options.body);
        return { data: { success: true, recorded: true }, error: null };
      },
    },
  };

  await recordInviteLandingGrowth(client, REFERRER_ID, {
    platform: "web",
    surface: "invite_redirect",
  });

  assert.deepEqual(
    calls.map((call) => (call as { event_type: string }).event_type),
    ["landing", "invite_click"],
  );
  assert.deepEqual(calls.map((call) => (call as { referral_token: string }).referral_token), [
    REFERRER_ID,
    REFERRER_ID,
  ]);
});

test("keeps referral token out of growth context summaries", () => {
  const body = buildReferralGrowthEventBody({
    referralToken: REFERRER_ID,
    eventType: "landing",
    context: {
      platform: "web",
      surface: "invite_redirect",
      city: " Istanbul ",
      eventId: "event-123",
      isPremium: false,
    },
  });

  assert.equal(body.referral_token, REFERRER_ID);
  assert.deepEqual(body.context, {
    platform: "web",
    surface: "invite_redirect",
    city: "Istanbul",
    event_id: "event-123",
    is_premium: false,
  });
  assert.equal(Object.values(body.context).includes(REFERRER_ID), false);
});

test("applies stored referrals through claim logging when available", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);
  const calls: string[] = [];

  const result = await applyStoredReferralAttribution(
    createClient(async (fn, params) => {
      calls.push(fn);
      assert.equal(fn, "claim_growth_attribution");
      assert.deepEqual(params.p_context, {
        platform: "web",
        surface: "auth_post_login",
        event_id: "event-456",
        is_premium: true,
      });
      return {
        data: {
          success: true,
          applied_referral_result: { status: "applied", referrer_id: REFERRER_ID },
        },
        error: null,
      };
    }),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login", eventId: "event-456", isPremium: true },
  );

  assert.deepEqual(result, { status: "applied", referrerId: REFERRER_ID });
  assert.deepEqual(calls, ["claim_growth_attribution"]);
  assert.equal(values.size, 0);
});

test("clears malformed stored referrals as invalid without calling RPCs", async () => {
  const { storage, values } = createStorage();
  values.set(REFERRAL_STORAGE_KEY, "not-a-referral");

  const result = await applyStoredReferralAttribution(
    createClient(async () => {
      throw new Error("invalid stored referral should not call RPCs");
    }),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "invalid" });
  assert.equal(values.size, 0);
});

test("does not call RPCs for self-referrals", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);

  const result = await applyStoredReferralAttribution(
    createClient(async () => {
      throw new Error("self-referral should not call RPCs");
    }),
    storage,
    REFERRER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "self" });
  assert.equal(values.size, 0);
});

test("clears already-set attribution responses", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);

  const result = await applyStoredReferralAttribution(
    createClient(async () => ({
      data: {
        success: true,
        applied_referral_result: { status: "already-set", referrer_id: OTHER_REFERRER_ID },
      },
      error: null,
    })),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "already-set", referrerId: OTHER_REFERRER_ID });
  assert.equal(values.size, 0);
});

test("clears invalid attribution responses", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);

  const result = await applyStoredReferralAttribution(
    createClient(async () => ({
      data: {
        success: true,
        applied_referral_result: { status: "invalid" },
      },
      error: null,
    })),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "invalid" });
  assert.equal(values.size, 0);
});

test("keeps missing-profile referrals pending for a later retry", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);

  const result = await applyStoredReferralAttribution(
    createClient(async (_fn) => ({
      data: { status: "missing-profile" },
      error: null,
    })),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "missing-profile", referrerId: REFERRER_ID });
  assert.equal(values.size, 1);
});

test("keeps claim-level missing-profile referrals pending without a duplicate fallback", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);
  const calls: string[] = [];

  const result = await applyStoredReferralAttribution(
    createClient(async (fn) => {
      calls.push(fn);
      return {
        data: {
          success: true,
          applied_referral_result: { status: "missing-profile" },
        },
        error: null,
      };
    }),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "missing-profile", referrerId: REFERRER_ID });
  assert.deepEqual(calls, ["claim_growth_attribution"]);
  assert.equal(values.size, 1);
});

test("falls back to the direct attribution RPC when claim logging fails", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);
  const calls: string[] = [];

  const result = await applyStoredReferralAttribution(
    createClient(async (fn) => {
      calls.push(fn);
      if (fn === "claim_growth_attribution") {
        return { data: null, error: new Error("claim unavailable") };
      }
      return { data: { status: "applied", referrer_id: REFERRER_ID }, error: null };
    }),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.deepEqual(result, { status: "applied", referrerId: REFERRER_ID });
  assert.deepEqual(calls, ["claim_growth_attribution", "apply_referral_attribution"]);
  assert.equal(values.size, 0);
});

test("returns rpc-failed and keeps storage when all attribution RPCs fail", async () => {
  const { storage, values } = createStorage();
  await storeReferralId(storage, REFERRER_ID);

  const result = await applyStoredReferralAttribution(
    createClient(async (fn) => ({
      data: null,
      error: new Error(`${fn} failed`),
    })),
    storage,
    CURRENT_USER_ID,
    { platform: "web", surface: "auth_post_login" },
  );

  assert.equal(result.status, "rpc-failed");
  assert.equal(result.referrerId, REFERRER_ID);
  assert.match(result.message, /apply_referral_attribution failed/);
  assert.equal(values.size, 1);
});
