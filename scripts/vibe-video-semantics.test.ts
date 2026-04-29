import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBunnyVideoStatus,
  normalizeBunnyVideoUid,
  resolveCanonicalVibeVideoState,
} from "../shared/vibeVideoSemantics.ts";

test("canonical Vibe Video semantics separate score eligibility from playback readiness", () => {
  const uploading = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "  video-uploading  ",
    bunnyVideoStatus: "uploading",
  });
  assert.deepEqual(uploading, {
    state: "processing",
    uid: "video-uploading",
    status: "uploading",
    isScoreEligible: true,
  });

  const processing = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-processing",
    bunnyVideoStatus: "processing",
  });
  assert.equal(processing.state, "processing");
  assert.equal(processing.isScoreEligible, true);

  const ready = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-ready",
    bunnyVideoStatus: "ready",
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.isScoreEligible, true);

  const failed = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-failed",
    bunnyVideoStatus: "failed",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.isScoreEligible, true);

  const none = resolveCanonicalVibeVideoState({
    bunnyVideoUid: null,
    bunnyVideoStatus: "none",
  });
  assert.equal(none.state, "none");
  assert.equal(none.isScoreEligible, false);
});

test("UID plus missing, null, or unknown status remains processing and score eligible", () => {
  for (const status of [undefined, null, "", "unknown-provider-status", "1", "2"] as const) {
    const info = resolveCanonicalVibeVideoState({
      bunnyVideoUid: "video-in-pipeline",
      bunnyVideoStatus: status,
    });
    assert.equal(info.state, "processing", `status ${String(status)} should stay processing`);
    assert.equal(info.isScoreEligible, true, `status ${String(status)} should keep score credit`);
  }

  assert.equal(normalizeBunnyVideoStatus("3"), "ready");
  assert.equal(normalizeBunnyVideoStatus("4"), "ready");
  assert.equal(normalizeBunnyVideoStatus("5"), "failed");
  assert.equal(normalizeBunnyVideoUid("   "), null);
});

test("delete clears score eligibility and re-upload keeps processing semantics", () => {
  const beforeDelete = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-before-delete",
    bunnyVideoStatus: "ready",
  });
  const afterDelete = resolveCanonicalVibeVideoState({
    bunnyVideoUid: null,
    bunnyVideoStatus: "none",
  });
  assert.equal(beforeDelete.isScoreEligible, true);
  assert.equal(afterDelete.state, "none");
  assert.equal(afterDelete.isScoreEligible, false);

  const reupload = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-reupload",
    bunnyVideoStatus: "uploading",
  });
  assert.equal(reupload.state, "processing");
  assert.equal(reupload.isScoreEligible, true);
});

