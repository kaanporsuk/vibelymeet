import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMediaFallbackCopy } from "./mediaFallbackCopy";

const root = process.cwd();
const source = readFileSync(join(root, "shared/media/mediaFallbackCopy.ts"), "utf8");

test("media fallback copy defines retry policy without raw provider details", () => {
  assert.deepEqual(resolveMediaFallbackCopy({ reason: "auth_expired" }), {
    title: "Media access expired",
    message: "We are refreshing this media. Try again if it does not load.",
    actionLabel: "Retry",
    retryPolicy: "auto_refresh_once",
    telemetryReason: "auth_expired",
  });
  assert.equal(resolveMediaFallbackCopy({ reason: "asset_deleted" }).retryPolicy, "no_retry");
  assert.equal(resolveMediaFallbackCopy({ reason: "provider_unreachable" }).actionLabel, "Retry");
});

test("media fallback copy contract has no signed URL or provider path fields", () => {
  for (const forbidden of ["signed_url", "provider_path", "asset_id", "user_id", "profile_id"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});
