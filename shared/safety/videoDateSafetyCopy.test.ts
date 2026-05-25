import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVideoDateSafetySubmitCopy } from "./videoDateSafetyCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("video-date safety submit copy covers report, block, end, and survey routing", () => {
  assert.deepEqual(resolveVideoDateSafetySubmitCopy({
    ok: true,
    mode: "report",
    alsoBlock: true,
  }), {
    title: "Report received",
    message: "Thanks. We received your report and our team will review it. This person is blocked.",
    primaryActionLabel: "Continue call",
    secondaryActionLabel: null,
    tone: "success",
    nextDestination: "stay",
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
    retryable: true,
  }), {
    title: "Could not send report",
    message: "You have sent several reports recently. Please try again later.",
    primaryActionLabel: "Try again",
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

test("web and native safety surfaces consume shared submit copy", () => {
  const webSafetyModal = read("src/components/video-date/InCallSafetyModal.tsx");
  assert.match(webSafetyModal, /resolveVideoDateSafetySubmitCopy/);
  assert.match(webSafetyModal, /copy\.tone === "warning"/);
  assert.match(webSafetyModal, /toast\.info\(copy\.title/);
  assert.match(read("apps/mobile/components/video-date/InCallSafetySheet.tsx"), /resolveVideoDateSafetySubmitCopy/);
});
