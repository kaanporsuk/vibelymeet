export type NativeCameraFacingMode = "user" | "environment";

export type NativeCameraSwitchCommitInput = {
  baselineDeviceKey: string | null;
  baselineFacingMode: NativeCameraFacingMode | null;
  beforeDeviceKey: string | null;
  beforeFacingMode: NativeCameraFacingMode | null;
  beforeTrackId: string | null;
  previousControlsFacing: NativeCameraFacingMode | null;
  expectedDeviceKey: string | null;
  expectedFacing: NativeCameraFacingMode | null;
  snapshotDeviceKey: string | null;
  snapshotFacingMode: NativeCameraFacingMode | null;
  snapshotTrackId: string | null;
  controlsFacing: NativeCameraFacingMode | null;
  readyState: string | null;
  enabled: boolean | null;
};

export type NativeCameraSwitchCommitResolution = {
  shouldCommit: boolean;
  committedFacing: NativeCameraFacingMode | null;
  live: boolean;
  trackChanged: boolean;
  deviceChanged: boolean;
  facingChanged: boolean;
  expectedDeviceMatched: boolean;
  expectedFacingMatched: boolean;
  expectedDeviceSignalPresent: boolean;
  expectedFacingSignalPresent: boolean;
  trackChangedToExpectedTarget: boolean;
  trackChangedWithoutIdentity: boolean;
  controlsFacingChangedFromBefore: boolean;
  controlsFacingChangedFromPrevious: boolean;
  snapshotFacingChangedFromBefore: boolean;
};

export function resolveNativeCameraSwitchCommit({
  baselineDeviceKey,
  baselineFacingMode,
  beforeDeviceKey,
  beforeFacingMode,
  beforeTrackId,
  previousControlsFacing,
  expectedDeviceKey,
  expectedFacing,
  snapshotDeviceKey,
  snapshotFacingMode,
  snapshotTrackId,
  controlsFacing,
  readyState,
  enabled,
}: NativeCameraSwitchCommitInput): NativeCameraSwitchCommitResolution {
  const committedFacing =
    (expectedFacing && controlsFacing === expectedFacing ? expectedFacing : null) ??
    (expectedFacing && snapshotFacingMode === expectedFacing ? expectedFacing : null) ??
    controlsFacing ??
    snapshotFacingMode;
  const trackChanged = Boolean(beforeTrackId && snapshotTrackId && snapshotTrackId !== beforeTrackId);
  const deviceChanged = Boolean(
    baselineDeviceKey &&
      snapshotDeviceKey &&
      snapshotDeviceKey !== baselineDeviceKey &&
      (!beforeDeviceKey || snapshotDeviceKey !== beforeDeviceKey),
  );
  const controlsFacingChangedFromBefore = Boolean(
    beforeFacingMode &&
      controlsFacing &&
      controlsFacing !== beforeFacingMode,
  );
  const controlsFacingChangedFromPrevious = Boolean(
    previousControlsFacing &&
      controlsFacing &&
      controlsFacing !== previousControlsFacing,
  );
  const snapshotFacingChangedFromBefore = Boolean(
    beforeFacingMode &&
      snapshotFacingMode &&
      snapshotFacingMode !== beforeFacingMode,
  );
  const cameraIdentityChanged = trackChanged || deviceChanged;
  const controlsFacingChanged = Boolean(
    baselineFacingMode &&
      controlsFacing &&
      controlsFacing !== baselineFacingMode &&
      (controlsFacingChangedFromBefore || controlsFacingChangedFromPrevious || cameraIdentityChanged),
  );
  const snapshotFacingChanged = Boolean(
    baselineFacingMode &&
      snapshotFacingMode &&
      snapshotFacingMode !== baselineFacingMode &&
      (snapshotFacingChangedFromBefore || cameraIdentityChanged),
  );
  const facingChanged = controlsFacingChanged || snapshotFacingChanged;
  const expectedDeviceSignalPresent = Boolean(
    expectedDeviceKey &&
      expectedDeviceKey !== baselineDeviceKey &&
      snapshotDeviceKey === expectedDeviceKey,
  );
  const expectedDeviceMatched = Boolean(
    expectedDeviceSignalPresent &&
      (!beforeDeviceKey || expectedDeviceKey !== beforeDeviceKey),
  );
  const controlsExpectedFacingMatched = Boolean(
    expectedFacing &&
      expectedFacing !== baselineFacingMode &&
      controlsFacing === expectedFacing &&
      (controlsFacingChangedFromBefore || controlsFacingChangedFromPrevious || cameraIdentityChanged),
  );
  const snapshotExpectedFacingMatched = Boolean(
    expectedFacing &&
      expectedFacing !== baselineFacingMode &&
      snapshotFacingMode === expectedFacing &&
      (snapshotFacingChangedFromBefore || cameraIdentityChanged),
  );
  const expectedFacingSignalPresent = controlsExpectedFacingMatched || snapshotExpectedFacingMatched;
  const expectedFacingMatched = expectedFacingSignalPresent;
  const trackChangedToExpectedTarget = Boolean(
    trackChanged &&
      (expectedDeviceSignalPresent || expectedFacingSignalPresent),
  );
  const trackChangedWithoutIdentity = Boolean(
    trackChanged &&
      !baselineDeviceKey &&
      !baselineFacingMode &&
      !expectedDeviceKey &&
      !expectedFacing,
  );
  const live = readyState === "live" && enabled !== false;
  const shouldCommit = Boolean(
    live &&
      (
        expectedDeviceMatched ||
        expectedFacingMatched ||
        deviceChanged ||
        facingChanged ||
        trackChangedToExpectedTarget ||
        trackChangedWithoutIdentity
      ),
  );

  return {
    shouldCommit,
    committedFacing,
    live,
    trackChanged,
    deviceChanged,
    facingChanged,
    expectedDeviceMatched,
    expectedFacingMatched,
    expectedDeviceSignalPresent,
    expectedFacingSignalPresent,
    trackChangedToExpectedTarget,
    trackChangedWithoutIdentity,
    controlsFacingChangedFromBefore,
    controlsFacingChangedFromPrevious,
    snapshotFacingChangedFromBefore,
  };
}

export type NativeMatchCallCameraFacingMode = NativeCameraFacingMode;
export type NativeMatchCallCameraSwitchCommitInput = NativeCameraSwitchCommitInput;
export type NativeMatchCallCameraSwitchCommitResolution = NativeCameraSwitchCommitResolution;
export const resolveNativeMatchCallCameraSwitchCommit = resolveNativeCameraSwitchCommit;
