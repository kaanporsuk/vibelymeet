import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVideoDatePhaseCountdown } from "./videoDateCountdown";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("warm-up countdown derives from authoritative started-at timestamp", () => {
  const startedAt = "2026-05-03T18:55:36.000Z";
  const countdown = resolveVideoDatePhaseCountdown({
    phase: "handshake",
    handshakeStartedAtIso: startedAt,
    handshakeDurationSeconds: 60,
    dateDurationSeconds: 300,
    nowMs: Date.parse("2026-05-03T18:56:01.000Z"),
  });

  assert.equal(countdown.hasAuthoritativeStart, true);
  assert.equal(countdown.remainingSeconds, 35);
  assert.equal(countdown.deadlineMs, Date.parse("2026-05-03T18:56:36.000Z"));
  assert.equal(countdown.formattedTime, "0:35");
  assert.ok(countdown.progress > 0.58 && countdown.progress < 0.59);
});

test("final-ten state is computed from remaining server deadline time", () => {
  const countdown = resolveVideoDatePhaseCountdown({
    phase: "handshake",
    handshakeStartedAtIso: "2026-05-03T18:55:36.000Z",
    handshakeDurationSeconds: 60,
    dateDurationSeconds: 300,
    nowMs: Date.parse("2026-05-03T18:56:27.000Z"),
  });

  assert.equal(countdown.remainingSeconds, 9);
  assert.equal(countdown.isFinalTenSeconds, true);
});

test("date countdown includes backend-confirmed extension seconds", () => {
  const countdown = resolveVideoDatePhaseCountdown({
    phase: "date",
    dateStartedAtIso: "2026-05-03T18:56:36.000Z",
    handshakeDurationSeconds: 60,
    dateDurationSeconds: 300,
    dateExtraSeconds: 120,
    nowMs: Date.parse("2026-05-03T19:00:36.000Z"),
  });

  assert.equal(countdown.remainingSeconds, 180);
  assert.equal(countdown.durationMs, 420_000);
  assert.equal(countdown.formattedTime, "3:00");
});

test("countdown model clamps invalid duration input to safe UI values", () => {
  const countdown = resolveVideoDatePhaseCountdown({
    phase: "handshake",
    handshakeStartedAtIso: "2026-05-03T18:55:36.000Z",
    handshakeDurationSeconds: Number.NaN,
    dateDurationSeconds: 300,
    nowMs: Date.parse("2026-05-03T18:55:45.000Z"),
  });

  assert.equal(countdown.hasAuthoritativeStart, false);
  assert.equal(countdown.remainingSeconds, null);
  assert.equal(countdown.durationMs, 0);
  assert.equal(countdown.progress, 1);
  assert.equal(countdown.formattedTime, "0:00");
});

test("decision guidance belongs to Pass/Vibe, not icebreaker", () => {
  const webIceBreaker = read("src/components/video-date/IceBreakerCard.tsx");
  const nativeIceBreaker = read("apps/mobile/components/video-date/IceBreakerCard.tsx");
  const webDecision = read("src/components/video-date/VibeCheckButton.tsx");
  const nativeDecision = read("apps/mobile/components/video-date/VibeCheckButton.tsx");

  assert.equal(webIceBreaker.includes("Choose when it feels right"), false);
  assert.equal(nativeIceBreaker.includes("Choose when it feels right"), false);
  assert.equal(webDecision.includes("Choose when it feels right"), true);
  assert.equal(nativeDecision.includes("Choose when it feels right"), true);
  assert.equal(webDecision.includes("Soft nudge"), false);
  assert.equal(nativeDecision.includes("Soft nudge"), false);
  assert.equal(webDecision.includes("Choose from the feeling"), false);
  assert.equal(nativeDecision.includes("Choose from the feeling"), false);
});

test("web desktop stage and native timer hardening contracts remain in place", () => {
  const webDate = read("src/pages/VideoDate.tsx");
  const nativeDate = read("apps/mobile/app/date/[id].tsx");
  const nativeCountdownBlock = nativeDate.slice(
    nativeDate.indexOf("Authoritative visible countdown"),
    nativeDate.indexOf("const toggleMute"),
  );

  assert.equal(webDate.includes("data-video-date-stage"), true);
  assert.equal(webDate.includes("md:w-[min(calc(100vw_-_2rem),500px)]"), true);
  assert.equal(webDate.includes("md:h-[min(calc(100dvh_-_2rem),920px)]"), true);
  assert.equal(nativeCountdownBlock.includes("resolveVideoDatePhaseCountdown"), true);
  assert.equal(webDate.includes("let completionFired = false"), true);
  assert.equal(nativeCountdownBlock.includes("let completionFired = false"), true);
  assert.equal(webDate.includes("countdownCompletionKeyRef"), true);
  assert.equal(nativeCountdownBlock.includes("countdownCompletionKeyRef"), true);
  assert.equal(nativeCountdownBlock.includes("hasRemotePartner"), false);
  assert.equal(nativeCountdownBlock.includes("isTimerPaused"), false);
  assert.equal(nativeDate.includes("addTimeFab"), false);
});
