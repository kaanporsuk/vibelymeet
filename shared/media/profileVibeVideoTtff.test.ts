import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetProfileVibeVideoTtffForTest,
  beginProfileVibeVideoTtffPlayback,
  completeProfileVibeVideoTtffPlayback,
  markProfileVibeVideoTtffPrewarm,
  profileVibeVideoTtffBucket,
} from "./profileVibeVideoTtff.ts";

test("profile vibe video TTFF records warm context without leaking identifiers", () => {
  __resetProfileVibeVideoTtffForTest();
  markProfileVibeVideoTtffPrewarm({
    profileId: "profile-secret-id",
    nowMs: 1_000,
    platform: "web",
    surface: "lobby_card",
    trigger: "pointer_down",
    sourceKind: "profile_vibe_video_ref",
    usesSignedProfileRef: true,
  });

  const token = beginProfileVibeVideoTtffPlayback({
    profileId: "profile-secret-id",
    nowMs: 1_180,
    platform: "web",
    surface: "profile_inline",
    trigger: "watch_intro",
    sourceKind: "profile_vibe_video_ref",
    usesSignedProfileRef: true,
  });
  const payload = completeProfileVibeVideoTtffPlayback({ token, nowMs: 1_760 });

  assert.deepEqual(payload, {
    platform: "web",
    surface: "profile_inline",
    trigger: "watch_intro",
    ttff_ms: 580,
    ttff_bucket: "501_700",
    warm_intent: true,
    prewarm_age_ms: 180,
    prewarm_trigger: "pointer_down",
    prewarm_surface: "lobby_card",
    reduce_motion: false,
    signed_profile_ref: true,
    source_kind: "profile_vibe_video_ref",
    outcome: "first_frame",
  });
  assert.equal(JSON.stringify(payload).includes("profile-secret-id"), false);
});

test("profile vibe video TTFF is one-shot and expires old entries", () => {
  __resetProfileVibeVideoTtffForTest();
  markProfileVibeVideoTtffPrewarm({
    profileId: "profile-a",
    nowMs: 0,
    surface: "lobby_card",
    trigger: "press_in",
  });
  const token = beginProfileVibeVideoTtffPlayback({
    profileId: "profile-a",
    nowMs: 130_000,
    surface: "profile_fullscreen",
    trigger: "fullscreen_open",
  });

  const payload = completeProfileVibeVideoTtffPlayback({ token, nowMs: 130_900 });
  assert.equal(payload?.warm_intent, false);
  assert.equal(payload?.prewarm_age_ms, null);
  assert.equal(completeProfileVibeVideoTtffPlayback({ token, nowMs: 130_950 }), null);
});

test("profile vibe video TTFF preserves first intent when click or press fallbacks repeat prewarm", () => {
  __resetProfileVibeVideoTtffForTest();
  markProfileVibeVideoTtffPrewarm({
    profileId: "profile-fallback",
    nowMs: 500,
    platform: "web",
    surface: "lobby_card",
    trigger: "pointer_down",
  });
  markProfileVibeVideoTtffPrewarm({
    profileId: "profile-fallback",
    nowMs: 620,
    platform: "web",
    surface: "lobby_card",
    trigger: "click",
    sourceKind: "profile_vibe_video_ref",
    usesSignedProfileRef: true,
  });

  const token = beginProfileVibeVideoTtffPlayback({
    profileId: "profile-fallback",
    nowMs: 700,
    platform: "web",
    surface: "profile_inline",
    trigger: "watch_intro",
    sourceKind: "profile_vibe_video_ref",
    usesSignedProfileRef: true,
  });
  const payload = completeProfileVibeVideoTtffPlayback({ token, nowMs: 1_100 });

  assert.equal(payload?.warm_intent, true);
  assert.equal(payload?.prewarm_age_ms, 200);
  assert.equal(payload?.prewarm_trigger, "pointer_down");
  assert.equal(payload?.prewarm_surface, "lobby_card");
  assert.equal(payload?.source_kind, "profile_vibe_video_ref");
  assert.equal(payload?.signed_profile_ref, true);
});

test("profile vibe video TTFF buckets are stable", () => {
  assert.equal(profileVibeVideoTtffBucket(250), "0_250");
  assert.equal(profileVibeVideoTtffBucket(500), "251_500");
  assert.equal(profileVibeVideoTtffBucket(700), "501_700");
  assert.equal(profileVibeVideoTtffBucket(1_200), "701_1200");
  assert.equal(profileVibeVideoTtffBucket(1_500), "1201_1500");
  assert.equal(profileVibeVideoTtffBucket(2_500), "1501_2500");
  assert.equal(profileVibeVideoTtffBucket(9_999), "2501_plus");
});

test("profile vibe video TTFF normalizes freeform labels and clamps durations", () => {
  __resetProfileVibeVideoTtffForTest();
  markProfileVibeVideoTtffPrewarm({
    profileId: "profile-b",
    nowMs: 10,
    platform: "https://bad.example",
    surface: "/user/profile-b",
    trigger: "Bearer secret",
    sourceKind: "signed-url",
  });
  const token = beginProfileVibeVideoTtffPlayback({
    profileId: "profile-b",
    nowMs: 20,
    platform: "native",
    surface: "native_profile_fullscreen",
    trigger: "manual_play",
    sourceKind: "profile_vibe_video_ref",
  });
  const payload = completeProfileVibeVideoTtffPlayback({ token, nowMs: 120_020 });

  assert.equal(payload?.platform, "native");
  assert.equal(payload?.surface, "native_profile_fullscreen");
  assert.equal(payload?.trigger, "manual_play");
  assert.equal(payload?.ttff_ms, 120_000);
  assert.equal(payload?.prewarm_trigger, "autoplay");
  assert.equal(payload?.prewarm_surface, "profile_inline");
  assert.equal(JSON.stringify(payload).includes("bad.example"), false);
  assert.equal(JSON.stringify(payload).includes("Bearer"), false);
});
