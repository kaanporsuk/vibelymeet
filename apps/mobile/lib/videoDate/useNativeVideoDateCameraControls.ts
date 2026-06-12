import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";
import {
  trackEvent,
} from "@/lib/analytics";
import {
  type DailyCallObject,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  chooseNativeCameraDevice,
  describeNativeCameraSwitchError,
  NATIVE_CAMERA_SWITCH_COMMIT_POLL_MS,
  NATIVE_CAMERA_SWITCH_COMMIT_TIMEOUT_MS,
  nativeCameraDeviceFacingMode,
  nativeCameraDeviceId,
  nativeCameraDeviceKey,
  type NativeCameraSwitchCommit,
  type NativeCameraSwitchCommitExpectation,
  type NativeCameraSwitchCommitMethod,
  type NativeDailyAppMessageControls,
  type NativeDailyCameraControls,
  type NativeDailyCameraFacingMode,
  nativeLocalCameraSnapshot,
  type NativeLocalCameraSnapshot,
  normalizeNativeCameraFacingMode,
  oppositeNativeCameraFacingMode,
  sleepNativeCameraSwitch,
} from "@/lib/daily/nativeDailyMediaHelpers";
import {
  videoDateDailyDiagnostic,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  resolveNativeCameraSwitchCommit,
} from "@clientShared/chat/nativeCameraSwitchCommit";
import {
  createVideoDateCameraSwitchRenderHint,
} from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import {
  type DailyParticipant,
} from "@daily-co/react-native-daily-js";
import {
  Platform,
} from "react-native";

/**
 * In-call camera/mic controls concern of the native Video Date screen: mute/video toggles, camera-switch commit watch, and flip-camera orchestration.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateCameraControlsDeps {
  callRef: MutableRefObject<DailyCallObject | null>;
  eventId: string;
  isFlippingCamera: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  joinAttemptNonce: number;
  localParticipant: DailyParticipant | null;
  localParticipantRef: MutableRefObject<DailyParticipant | null>;
  nativeCameraSwitchInFlightRef: MutableRefObject<boolean>;
  sessionId: string;
  setCanFlipCamera: Dispatch<SetStateAction<boolean>>;
  setIsFlippingCamera: Dispatch<SetStateAction<boolean>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  setIsVideoOff: Dispatch<SetStateAction<boolean>>;
}

export function useNativeVideoDateCameraControls(deps: NativeVideoDateCameraControlsDeps) {
  const {
    callRef,
    eventId,
    isFlippingCamera,
    isMuted,
    isVideoOff,
    joinAttemptNonce,
    localParticipant,
    localParticipantRef,
    nativeCameraSwitchInFlightRef,
    sessionId,
    setCanFlipCamera,
    setIsFlippingCamera,
    setIsMuted,
    setIsVideoOff,
  } = deps;

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const nextMuted = !isMuted;
    // Daily: setLocalAudio(true) = mic on, false = mic off.
    call.setLocalAudio(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const nextVideoOff = !isVideoOff;
    call.setLocalVideo(!nextVideoOff);
    setIsVideoOff(nextVideoOff);
  }, [isVideoOff]);

  const readNativeLocalCameraSnapshot = useCallback(
    (call: DailyCallObject | null | undefined) => {
      let local = localParticipantRef.current;
      try {
        const callLocal = call?.participants?.()?.local as
          | DailyParticipant
          | undefined;
        if (callLocal) {
          local = callLocal;
          localParticipantRef.current = callLocal;
        }
      } catch {
        /* Keep the most recent participant snapshot from Daily events. */
      }
      return nativeLocalCameraSnapshot(local);
    },
    [],
  );

  const waitForNativeCameraSwitchCommit = useCallback(
    async (
      controls: NativeDailyCameraControls,
      call: DailyCallObject,
      before: NativeLocalCameraSnapshot,
      method: NativeCameraSwitchCommitMethod,
      expectation: NativeCameraSwitchCommitExpectation,
    ): Promise<NativeCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      const baselineDeviceKey =
        before.deviceId == null ? null : String(before.deviceId);
      const beforeDeviceKey =
        before.deviceId == null ? null : String(before.deviceId);
      while (
        Date.now() - startedAtMs <=
        NATIVE_CAMERA_SWITCH_COMMIT_TIMEOUT_MS
      ) {
        let controlsFacing: NativeDailyCameraFacingMode | null = null;
        try {
          controlsFacing =
            typeof controls.getCameraFacingMode === "function"
              ? normalizeNativeCameraFacingMode(
                  await controls.getCameraFacingMode(),
                )
              : null;
        } catch {
          controlsFacing = null;
        }

        const snapshot = readNativeLocalCameraSnapshot(call);
        const commitResolution = resolveNativeCameraSwitchCommit({
          baselineDeviceKey,
          baselineFacingMode: expectation.baselineFacing,
          beforeDeviceKey,
          beforeFacingMode: before.facingMode,
          beforeTrackId: before.trackId,
          previousControlsFacing: expectation.previousControlsFacing,
          expectedDeviceKey: expectation.expectedDeviceKey ?? null,
          expectedFacing: expectation.expectedFacing ?? null,
          snapshotDeviceKey:
            snapshot.deviceId == null ? null : String(snapshot.deviceId),
          snapshotFacingMode: snapshot.facingMode,
          snapshotTrackId: snapshot.trackId,
          controlsFacing,
          readyState: snapshot.readyState,
          enabled: snapshot.enabled,
        });

        if (
          commitResolution.shouldCommit ||
          (commitResolution.live && !before.trackId)
        ) {
          return {
            ...snapshot,
            facingMode: commitResolution.committedFacing,
            method,
            latencyMs: Date.now() - startedAtMs,
          };
        }

        await sleepNativeCameraSwitch(NATIVE_CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readNativeLocalCameraSnapshot],
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const controls =
        callRef.current as unknown as NativeDailyCameraControls | null;
      if (
        Platform.OS === "web" ||
        isVideoOff ||
        !controls ||
        (typeof controls.cycleCamera !== "function" &&
          typeof controls.setCamera !== "function")
      ) {
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      if (typeof controls.enumerateDevices === "function") {
        try {
          const result = await controls.enumerateDevices();
          const videoDeviceCount = (result.devices ?? []).filter(
            (device) =>
              device.kind === undefined || device.kind === "videoinput",
          ).length;
          if (!cancelled) setCanFlipCamera(videoDeviceCount > 1);
          return;
        } catch {
          /* Fall back to capability detection below. */
        }
      }

      if (!cancelled) setCanFlipCamera(true);
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [isVideoOff, localParticipant, joinAttemptNonce]);

  useEffect(() => {
    if (isVideoOff) setCanFlipCamera(false);
  }, [isVideoOff]);

  const handleFlipCamera = useCallback(async () => {
    const call = callRef.current;
    const controls = call as unknown as NativeDailyCameraControls | null;
    if (
      !call ||
      !controls ||
      isFlippingCamera ||
      nativeCameraSwitchInFlightRef.current ||
      isVideoOff ||
      (typeof controls.setCamera !== "function" &&
        typeof controls.cycleCamera !== "function")
    ) {
      if (
        !controls ||
        (typeof controls?.setCamera !== "function" &&
          typeof controls?.cycleCamera !== "function")
      ) {
        setCanFlipCamera(false);
      }
      return;
    }

    nativeCameraSwitchInFlightRef.current = true;
    setIsFlippingCamera(true);
    try {
      const before = readNativeLocalCameraSnapshot(call);
      let beforeControlsFacing: NativeDailyCameraFacingMode | null = null;
      if (typeof controls.getCameraFacingMode === "function") {
        try {
          beforeControlsFacing = normalizeNativeCameraFacingMode(
            await controls.getCameraFacingMode(),
          );
        } catch {
          beforeControlsFacing = null;
        }
      }
      const currentFacing = beforeControlsFacing ?? before.facingMode;
      const commitExpectationBase = {
        baselineFacing: currentFacing,
        previousControlsFacing: beforeControlsFacing,
      } satisfies Pick<
        NativeCameraSwitchCommitExpectation,
        "baselineFacing" | "previousControlsFacing"
      >;
      const desiredFacing = oppositeNativeCameraFacingMode(currentFacing);
      let commit: NativeCameraSwitchCommit | null = null;

      if (
        typeof controls.enumerateDevices === "function" &&
        typeof controls.setCamera === "function"
      ) {
        try {
          const result = await controls.enumerateDevices();
          const targetDevice = chooseNativeCameraDevice(
            result.devices ?? [],
            desiredFacing,
            before,
          );
          const targetDeviceId = nativeCameraDeviceId(targetDevice);
          if (targetDeviceId != null) {
            const setResult = await controls.setCamera(targetDeviceId);
            const expectedDeviceKey = nativeCameraDeviceKey(targetDevice);
            const expectedFacing =
              desiredFacing ??
              nativeCameraDeviceFacingMode(targetDevice) ??
              normalizeNativeCameraFacingMode(setResult?.device?.facingMode);
            commit = await waitForNativeCameraSwitchCommit(
              controls,
              call,
              before,
              "set_camera",
              {
                ...commitExpectationBase,
                expectedDeviceKey,
                expectedFacing,
              },
            );
          }
        } catch (setCameraError) {
          videoDateDailyDiagnostic("native_camera_set_camera_failed", {
            sessionId: sessionId ?? null,
            eventId: eventId || null,
            desired_facing_mode: desiredFacing,
            before_controls_facing_mode: beforeControlsFacing,
            error: describeNativeCameraSwitchError(setCameraError),
          });
        }
      }

      if (!commit && typeof controls.cycleCamera === "function") {
        const result = await controls.cycleCamera();
        commit = await waitForNativeCameraSwitchCommit(
          controls,
          call,
          before,
          "cycle_camera",
          {
            ...commitExpectationBase,
            expectedFacing:
              normalizeNativeCameraFacingMode(result?.device?.facingMode) ??
              desiredFacing,
          },
        );
      }

      if (!commit) {
        const after = readNativeLocalCameraSnapshot(call);
        videoDateDailyDiagnostic("native_camera_switch_commit_failed", {
          sessionId: sessionId ?? null,
          eventId: eventId || null,
          desired_facing_mode: desiredFacing,
          before,
          after,
        });
        trackEvent("video_date_camera_switch_commit_failed", {
          platform: "native",
          session_id: sessionId ?? null,
          event_id: eventId || null,
          source_surface: "video_date_call",
          source_action: "camera_switch_commit_failed",
          desired_facing_mode: desiredFacing,
          before_track_id: before.trackId,
          before_device_id: before.deviceId,
          before_facing_mode: before.facingMode,
          after_track_id: after.trackId,
          after_device_id: after.deviceId,
          after_facing_mode: after.facingMode,
          after_ready_state: after.readyState,
        });
        return;
      }

      trackEvent("video_date_camera_switch_committed", {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: "video_date_call",
        source_action: "camera_switch_committed",
        method: commit.method,
        facing_mode: commit.facingMode,
        local_video_track_id: commit.trackId,
        local_video_device_id: commit.deviceId,
        commit_latency_ms: commit.latencyMs,
      });

      const hint = createVideoDateCameraSwitchRenderHint({
        sourcePlatform: "native",
        facingMode: commit.facingMode,
        commitConfirmed: true,
        commitMethod: commit.method,
        localVideoTrackId: commit.trackId,
        commitLatencyMs: commit.latencyMs,
      });
      try {
        const appMessageControls =
          callRef.current as unknown as NativeDailyAppMessageControls | null;
        await appMessageControls?.sendAppMessage?.(hint);
        videoDateDailyDiagnostic("native_camera_switch_render_hint_sent", {
          sessionId: sessionId ?? null,
          eventId: eventId || null,
          switch_id: hint.switchId,
          facing_mode: hint.facingMode,
          commit_method: hint.commitMethod,
          local_video_track_id: hint.localVideoTrackId,
          commit_latency_ms: hint.commitLatencyMs,
        });
      } catch (hintError) {
        videoDateDailyDiagnostic(
          "native_camera_switch_render_hint_send_failed",
          {
            sessionId: sessionId ?? null,
            eventId: eventId || null,
            switch_id: hint.switchId,
            error: describeNativeCameraSwitchError(hintError),
          },
        );
      }
      videoDateDailyDiagnostic("native_camera_flipped", {
        sessionId: sessionId ?? null,
        eventId: eventId || null,
        next_facing_mode: commit.facingMode,
        commit_method: commit.method,
        commit_latency_ms: commit.latencyMs,
      });
    } catch (error) {
      videoDateDailyDiagnostic("native_camera_flip_failed", {
        sessionId: sessionId ?? null,
        eventId: eventId || null,
        error: describeNativeCameraSwitchError(error),
      });
      trackEvent("video_date_flip_camera_failed", {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: "video_date_call",
        source_action: "flip_camera_failed",
        reason_code: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      nativeCameraSwitchInFlightRef.current = false;
      setIsFlippingCamera(false);
    }
  }, [
    eventId,
    isFlippingCamera,
    isVideoOff,
    readNativeLocalCameraSnapshot,
    sessionId,
    waitForNativeCameraSwitchCommit,
  ]);

  return {
    toggleMute,
    toggleVideo,
    handleFlipCamera,
  };
}

export type NativeVideoDateCameraControlsApi = ReturnType<typeof useNativeVideoDateCameraControls>;
