import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBunnyVideoStatus,
  normalizeBunnyVideoUid,
  resolveCanonicalVibeVideoState,
  VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS,
} from "../shared/vibeVideoSemantics.ts";
import { resolveWebVibeVideoState } from "../src/lib/vibeVideo/webVibeVideoState.ts";

test("canonical Vibe Video semantics separate score eligibility from playback readiness", () => {
  const uploading = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "  video-uploading  ",
    bunnyVideoStatus: "uploading",
  });
  assert.deepEqual(uploading, {
    state: "processing",
    uid: "video-uploading",
    status: "uploading",
    statusUpdatedAt: null,
    statusAgeMs: null,
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

test("processing becomes recoverable stale_processing after threshold and never becomes none", () => {
  const now = "2026-04-29T12:00:00.000Z";
  const fresh = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-fresh",
    bunnyVideoStatus: "processing",
    updatedAt: "2026-04-29T11:55:30.000Z",
    now,
  });
  assert.equal(fresh.state, "processing");
  assert.equal(fresh.isScoreEligible, true);

  const stale = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-stale",
    bunnyVideoStatus: "processing",
    updatedAt: "2026-04-29T11:40:00.000Z",
    now,
  });
  assert.equal(stale.state, "stale_processing");
  assert.equal(stale.statusUpdatedAt, "2026-04-29T11:40:00.000Z");
  assert.equal(stale.statusAgeMs, 20 * 60 * 1000);
  assert.equal(stale.isScoreEligible, true);

  const customThreshold = resolveCanonicalVibeVideoState({
    bunnyVideoUid: "video-custom-threshold",
    bunnyVideoStatus: "unknown-provider-status",
    updatedAt: "2026-04-29T11:58:00.000Z",
    now,
    staleProcessingThresholdMs: VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS,
  });
  assert.equal(customThreshold.state, "processing");
  assert.notEqual(customThreshold.state, "none");
});

test("ready state still requires a playable URL before canPlay is true", () => {
  const readyWithoutConfiguredHostname = resolveWebVibeVideoState({
    bunny_video_uid: "video-ready",
    bunny_video_status: "ready",
  });

  assert.equal(readyWithoutConfiguredHostname.state, "ready");
  assert.equal(readyWithoutConfiguredHostname.playbackUrl, null);
  assert.equal(readyWithoutConfiguredHostname.canPlay, false);
  assert.equal(readyWithoutConfiguredHostname.isScoreEligible, true);
});

test("web resolver keeps UID-backed pipeline and failed states manageable", () => {
  const processing = resolveWebVibeVideoState({
    bunny_video_uid: "video-processing",
    bunny_video_status: "processing",
  });
  assert.equal(processing.state, "processing");
  assert.equal(processing.canManage, true);
  assert.equal(processing.canDelete, true);

  const staleProcessing = resolveWebVibeVideoState({
    bunny_video_uid: "video-stale",
    bunny_video_status: "processing",
    updated_at: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(staleProcessing.state, "stale_processing");
  assert.equal(staleProcessing.canManage, true);
  assert.equal(staleProcessing.canDelete, true);

  const failed = resolveWebVibeVideoState({
    bunny_video_uid: "video-failed",
    bunny_video_status: "failed",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.canManage, true);
  assert.equal(failed.canDelete, true);

  const none = resolveWebVibeVideoState({
    bunny_video_uid: null,
    bunny_video_status: "none",
  });
  assert.equal(none.state, "none");
  assert.equal(none.canManage, false);
  assert.equal(none.canDelete, false);
  assert.equal(none.canRecord, true);
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
