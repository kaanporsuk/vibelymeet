import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function trackEventCalls(source: string): string[] {
  return source.match(/trackEvent\([^;]+?\);/gs) ?? [];
}

test("invite landing records growth attribution through the constrained wrapper", () => {
  const inviteRedirect = read("src/pages/InviteRedirect.tsx");
  assert.match(inviteRedirect, /recordInviteLandingGrowth/);
  assert.match(inviteRedirect, /surface: "invite_redirect"/);
  assert.match(inviteRedirect, /readReferralIdFromSearchParams/);
});

test("event referral capture uses the normalized shared storage helper", () => {
  const eventDetails = read("src/pages/EventDetails.tsx");
  assert.match(eventDetails, /captureBrowserReferral\(searchParams\)/);
  assert.doesNotMatch(eventDetails, /localStorage\.setItem\("vibely_referrer_id"/);
});

test("authenticated referral application attempts claim logging before direct fallback", () => {
  const attribution = read("shared/referralAttribution.ts");
  assert.match(attribution, /claim_growth_attribution/);
  assert.match(attribution, /apply_referral_attribution/);
  assert.ok(
    attribution.indexOf("claim_growth_attribution") < attribution.indexOf("apply_referral_attribution"),
    "claim logging should be attempted before the direct attribution fallback",
  );
});

test("invite analytics calls do not pass raw referral tokens or invite URLs", () => {
  const sources = [
    read("src/pages/Referrals.tsx"),
    read("src/pages/InviteRedirect.tsx"),
    read("apps/mobile/app/settings/referrals.tsx"),
    read("apps/mobile/components/invite/InviteFriendsSheet.tsx"),
  ];

  for (const source of sources) {
    for (const call of trackEventCalls(source)) {
      assert.doesNotMatch(call, /inviteLink|shareUrl|referral_token|referrer_id|referrerId|referredById/);
    }
  }
});

test("referral hub copy stays user-facing", () => {
  const webHub = read("src/pages/Referrals.tsx");
  const nativeHub = read("apps/mobile/app/settings/referrals.tsx");

  for (const source of [webHub, nativeHub]) {
    assert.doesNotMatch(source, /Existing `?referred_by`?/);
    assert.doesNotMatch(source, /canonical Vibely link/);
    assert.doesNotMatch(source, /keep your `?ref`? attached/);
    assert.match(source, /Your invite link is ready/);
    assert.match(source, /How it works/);
  }
});
