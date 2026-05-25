import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVideoDateExtensionCopy } from "./videoDateExtensionCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("video-date extension copy preserves current button semantics", () => {
  assert.equal(resolveVideoDateExtensionCopy({
    type: "extra_time",
    state: "partner_pending",
  }).label, "Accept +2");
  assert.equal(resolveVideoDateExtensionCopy({
    type: "extended_vibe",
    state: "available",
    mutualMode: true,
  }).label, "Ask +5");
  assert.equal(resolveVideoDateExtensionCopy({
    type: "extended_vibe",
    state: "available",
    mutualMode: false,
  }).label, "+5 min");
  assert.equal(resolveVideoDateExtensionCopy({ state: "insufficient_credits" }).label, "Get Credits");
});

test("video-date extension copy covers pending, applied, and failed messages", () => {
  assert.equal(
    resolveVideoDateExtensionCopy({ state: "local_pending", type: "extra_time" }).toastMessage,
    "Request sent. The date extends if your match accepts.",
  );
  assert.equal(
    resolveVideoDateExtensionCopy({ state: "applied", type: "extended_vibe", minutes: 5 }).toastMessage,
    "5 extra minutes added!",
  );
  assert.equal(
    resolveVideoDateExtensionCopy({ state: "failed", userMessage: "No credits left." }).message,
    "No credits left.",
  );
  assert.equal(
    resolveVideoDateExtensionCopy({ state: "applied", type: "extended_vibe", minutes: Number.NaN }).toastMessage,
    "5 extra minutes added!",
  );
});

test("web and native KeepTheVibe consume shared extension copy", () => {
  assert.match(read("src/components/video-date/KeepTheVibe.tsx"), /resolveVideoDateExtensionCopy/);
  assert.match(read("apps/mobile/components/video-date/KeepTheVibe.tsx"), /resolveVideoDateExtensionCopy/);
});
