import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveNativeCameraSwitchCommit,
  type NativeCameraSwitchCommitInput,
} from "./nativeCameraSwitchCommit";

const base: NativeCameraSwitchCommitInput = {
  baselineDeviceKey: "front",
  baselineFacingMode: "user",
  beforeDeviceKey: "front",
  beforeFacingMode: "user",
  beforeTrackId: "track-1",
  previousControlsFacing: "user",
  expectedDeviceKey: null,
  expectedFacing: "environment",
  snapshotDeviceKey: "front",
  snapshotFacingMode: "user",
  snapshotTrackId: "track-1",
  controlsFacing: "user",
  readyState: "live",
  enabled: true,
};

test("native camera commit accepts a real controls-only facing transition", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    beforeFacingMode: null,
    snapshotFacingMode: null,
    previousControlsFacing: "user",
    controlsFacing: "environment",
  });

  assert.equal(result.shouldCommit, true);
  assert.equal(result.expectedFacingMatched, true);
  assert.equal(result.controlsFacingChangedFromPrevious, true);
  assert.equal(result.committedFacing, "environment");
});

test("native camera commit accepts controls transition when track-facing baseline was stale", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    baselineFacingMode: "environment",
    beforeFacingMode: "user",
    previousControlsFacing: "environment",
    expectedFacing: "user",
    snapshotFacingMode: "user",
    controlsFacing: "user",
  });

  assert.equal(result.shouldCommit, true);
  assert.equal(result.expectedFacingMatched, true);
  assert.equal(result.controlsFacingChangedFromPrevious, true);
  assert.equal(result.committedFacing, "user");
});

test("native camera commit rejects a stale-baseline controls-only no-op", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    baselineFacingMode: "user",
    beforeFacingMode: "environment",
    previousControlsFacing: "environment",
    expectedFacing: "environment",
    snapshotFacingMode: null,
    controlsFacing: "environment",
  });

  assert.equal(result.shouldCommit, false);
  assert.equal(result.expectedFacingMatched, false);
  assert.equal(result.controlsFacingChangedFromPrevious, false);
});

test("native camera commit rejects controls already at expected facing when no prior snapshot exists", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    baselineFacingMode: "user",
    beforeFacingMode: null,
    previousControlsFacing: "environment",
    expectedFacing: "environment",
    snapshotFacingMode: null,
    controlsFacing: "environment",
  });

  assert.equal(result.shouldCommit, false);
  assert.equal(result.expectedFacingMatched, false);
});

test("native camera commit accepts a track-facing transition", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    snapshotFacingMode: "environment",
    controlsFacing: null,
  });

  assert.equal(result.shouldCommit, true);
  assert.equal(result.facingChanged, true);
  assert.equal(result.expectedFacingMatched, true);
  assert.equal(result.committedFacing, "environment");
});

test("native camera commit accepts expected device identity change without facing metadata", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    expectedDeviceKey: "back",
    snapshotDeviceKey: "back",
    snapshotFacingMode: null,
    controlsFacing: null,
  });

  assert.equal(result.shouldCommit, true);
  assert.equal(result.expectedDeviceMatched, true);
  assert.equal(result.deviceChanged, true);
});

test("native camera commit rejects matching signals while the track is not live", () => {
  const result = resolveNativeCameraSwitchCommit({
    ...base,
    controlsFacing: "environment",
    readyState: "ended",
  });

  assert.equal(result.shouldCommit, false);
  assert.equal(result.live, false);
});
