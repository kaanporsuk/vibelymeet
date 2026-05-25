import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isVideoDateSafetySubmitErrorRetryable,
  resolveVideoDateSafetyCopy,
  resolveVideoDateSafetySubmitCopy,
  resolveVideoDateSafetySubmitOutcome,
} from "./videoDateSafetyCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("video-date safety submit copy covers report, block, end, and survey routing", () => {
  assert.deepEqual(resolveVideoDateSafetySubmitCopy({
    ok: true,
    mode: "report",
    alsoBlock: true,
  }), {
    title: "Report sent",
    message: "We received your report and are ending the date. This person is blocked.",
    primaryActionLabel: "Continue",
    secondaryActionLabel: null,
    tone: "success",
    nextDestination: "lobby",
  });

  const endCopy = resolveVideoDateSafetySubmitCopy({
    ok: true,
    mode: "end",
    ended: true,
    surveyRequired: true,
    idempotent: true,
  });
  assert.equal(endCopy.title, "Report sent");
  assert.equal(endCopy.nextDestination, "survey");
  assert.match(endCopy.message, /Next, we will take you to feedback/);
  assert.match(endCopy.message, /nothing was duplicated/);
});

test("video-date safety submit copy maps error codes without echoing raw details", () => {
  assert.deepEqual(resolveVideoDateSafetySubmitCopy({
    ok: false,
    mode: "report",
    error: "rate_limited",
    retryable: isVideoDateSafetySubmitErrorRetryable("rate_limited"),
  }), {
    title: "Could not send report",
    message: "You have sent several reports recently. Please try again later.",
    primaryActionLabel: "Close",
    secondaryActionLabel: "Cancel",
    tone: "error",
    nextDestination: "stay",
  });
  assert.equal(
    resolveVideoDateSafetySubmitCopy({
      ok: false,
      mode: "report",
      error: "raw postgres: private details",
    }).message,
    "We could not send the report. Try again in a moment.",
  );
  assert.equal(
    resolveVideoDateSafetySubmitCopy({
      ok: false,
      mode: "report",
      error: "idempotency_conflict",
      retryable: false,
    }).message,
    "This safety action could not be verified. Reopen Safety and try again.",
  );
});

test("video-date safety submit copy handles recorded-report follow-up failure", () => {
  const copy = resolveVideoDateSafetySubmitCopy({
    ok: false,
    mode: "end",
    error: "safety_end_transition_rejected",
    reportRecorded: true,
  });
  assert.equal(copy.title, "Report received");
  assert.equal(copy.tone, "warning");
  assert.match(copy.message, /could not end the date/);
});

test("legacy safety copy helper name remains a stable alias", () => {
  const input = {
    ok: true,
    mode: "report" as const,
    alsoBlock: false,
  };
  assert.deepEqual(resolveVideoDateSafetyCopy(input), resolveVideoDateSafetySubmitCopy(input));
});

test("video-date safety submit outcome and retryability stay privacy-safe", () => {
  const blockOutcome = resolveVideoDateSafetySubmitOutcome({
    mode: "report",
    alsoBlock: true,
    ended: false,
    surveyRequired: false,
  });
  assert.equal(blockOutcome.ended, true);
  assert.equal(blockOutcome.nextDestination, "lobby");

  const outcome = resolveVideoDateSafetySubmitOutcome({
    mode: "report",
    alsoBlock: true,
    ended: true,
    surveyRequired: false,
    idempotent: true,
    reportRecorded: true,
    reportId: "report-1",
  });

  assert.deepEqual(outcome, {
    mode: "report",
    alsoBlock: true,
    ended: true,
    surveyRequired: false,
    idempotent: true,
    reportRecorded: true,
    reportId: "report-1",
    nextDestination: "lobby",
  });
  assert.equal(isVideoDateSafetySubmitErrorRetryable("command_in_progress"), true);
  assert.equal(isVideoDateSafetySubmitErrorRetryable("session_ended"), false);
  assert.equal(isVideoDateSafetySubmitErrorRetryable("raw postgres: private details"), true);
});

test("web and native safety surfaces consume shared submit copy", () => {
  const webSafetyModal = read("src/components/video-date/InCallSafetyModal.tsx");
  const webVideoDate = read("src/pages/VideoDate.tsx");
  const nativeVideoDate = read("apps/mobile/app/date/[id].tsx");
  const nativeSafetySheet = read("apps/mobile/components/video-date/InCallSafetySheet.tsx");
  assert.match(webSafetyModal, /resolveVideoDateSafetySubmitCopy/);
  assert.match(webSafetyModal, /submitInFlightRef/);
  assert.match(webSafetyModal, /isVideoDateSafetySubmitErrorRetryable/);
  assert.match(webSafetyModal, /resolveVideoDateSafetySubmitOutcome/);
  assert.match(webSafetyModal, /if \(!retryable\) \{\s*handleOpenChange\(false\);\s*\}/);
  assert.match(webSafetyModal, /copy\.tone === "warning"/);
  assert.match(webSafetyModal, /toast\.info\(copy\.title/);
  assert.match(nativeSafetySheet, /resolveVideoDateSafetySubmitCopy/);
  assert.match(nativeSafetySheet, /submitInFlightRef/);
  assert.match(nativeSafetySheet, /isVideoDateSafetySubmitErrorRetryable/);
  assert.match(nativeSafetySheet, /resolveVideoDateSafetySubmitOutcome/);
  assert.match(nativeSafetySheet, /if \(!retryable\) \{\s*reset\(\);\s*onClose\(\);\s*\}/);
  assert.match(webVideoDate, /const canOpenInCallSafety = Boolean\([\s\S]*partnerId && id && !showFeedback && phase !== "ended"/);
  assert.doesNotMatch(webVideoDate, /partnerId && !showFeedback && \(isConnected \|\| safetyAlwaysOnV2\.enabled\)/);
  assert.match(nativeVideoDate, /const canOpenInCallSafety = Boolean\([\s\S]*partnerId && sessionId && !showFeedback && phase !== 'ended'/);
  assert.doesNotMatch(nativeVideoDate, /partnerId && !showFeedback && \(hasRemotePartner \|\| safetyAlwaysOnV2\.enabled\)/);
  assert.match(webVideoDate, /onReportOnlySuccess=\{handleReportOnlySafetySuccess\}/);
  assert.match(nativeVideoDate, /onReportOnlySuccess=\{handleReportOnlySafetySuccess\}/);
  assert.match(webVideoDate, /suppressPartnerControlsAfterSafety/);
  assert.match(nativeVideoDate, /suppressPartnerControlsAfterSafety/);
});
