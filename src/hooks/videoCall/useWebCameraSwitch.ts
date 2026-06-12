import { useCallback, useEffect } from "react";
import { DailyCall } from "@daily-co/daily-js";
import { vdbg } from "@/lib/vdbg";
import { trackEvent } from "@/lib/analytics";
import { createVideoDateCameraSwitchRenderHint } from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import {
  CAMERA_SWITCH_COMMIT_POLL_MS,
  CAMERA_SWITCH_COMMIT_TIMEOUT_MS,
  chooseWebVideoDevice,
  describeCameraSwitchError,
  enumerateWebVideoDevices,
  getDeviceFacingMode,
  getDeviceId,
  getLocalCameraSnapshot,
  getLocalVideoTrack,
  getTrackDeviceId,
  getTrackFacingMode,
  isWebKitCameraSwitchRuntime,
  LocalCameraSnapshot,
  normalizeCameraFacingMode,
  oppositeCameraFacingMode,
  sleep,
  VideoDateCameraFacingMode,
  videoOnlyCameraSwitchConstraints,
  WebCameraDevice,
  WebCameraSwitchCommit,
  WebCameraSwitchCommitMethod,
} from "@/lib/daily/webDailyMediaHelpers";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";

/**
 * Camera-switch ownership concern of the web Video Date call (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns commit-before-hint ordering: a live local camera switch must be
 * committed (deterministic publish refresh preferred, cycleCamera fallback)
 * before the shared render hint is sent to the receiver.
 */
export function useWebCameraSwitch(deps: VideoCallSharedRuntime) {
  const {
    activeCallSessionIdRef,
    callObjectRef,
    cameraSwitchInFlightRef,
    captureProfileRef,
    isConnected,
    isFlippingCamera,
    isVideoOff,
    latestLocalParticipantRef,
    localStream,
    optionsRef,
    setCanFlipCamera,
    setIsFlippingCamera,
  } = deps;

  const readLocalCameraSnapshot = useCallback(
    (call: DailyCall): LocalCameraSnapshot => {
      let localParticipant = latestLocalParticipantRef.current;
      try {
        localParticipant = call.participants().local ?? localParticipant;
      } catch {
        /* Keep the most recent participant snapshot from Daily events. */
      }
      return getLocalCameraSnapshot(localParticipant);
    },
    [],
  );

  const waitForLocalCameraSwitchCommit = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      method: WebCameraSwitchCommitMethod,
      opts: {
        expectedFacing?: VideoDateCameraFacingMode | null;
        expectedDeviceId?: string | null;
        publishRefreshApplied?: boolean;
        timeoutMs?: number;
      } = {},
    ): Promise<WebCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      const timeoutMs = opts.timeoutMs ?? CAMERA_SWITCH_COMMIT_TIMEOUT_MS;
      while (Date.now() - startedAtMs <= timeoutMs) {
        const snapshot = readLocalCameraSnapshot(call);
        const trackChanged = Boolean(
          before.trackId &&
          snapshot.trackId &&
          snapshot.trackId !== before.trackId,
        );
        const deviceChanged = Boolean(
          before.deviceId &&
          snapshot.deviceId &&
          snapshot.deviceId !== before.deviceId,
        );
        const facingChanged = Boolean(
          before.facingMode &&
          snapshot.facingMode &&
          snapshot.facingMode !== before.facingMode,
        );
        const expectedDeviceMatched = Boolean(
          opts.expectedDeviceId &&
          opts.expectedDeviceId !== before.deviceId &&
          snapshot.deviceId === opts.expectedDeviceId,
        );
        const expectedFacingMatched = Boolean(
          opts.expectedFacing &&
          opts.expectedFacing !== before.facingMode &&
          snapshot.facingMode === opts.expectedFacing,
        );
        const live =
          snapshot.readyState === "live" && snapshot.enabled !== false;

        if (
          live &&
          (trackChanged ||
            deviceChanged ||
            facingChanged ||
            expectedDeviceMatched ||
            expectedFacingMatched ||
            !before.trackId)
        ) {
          return {
            ...snapshot,
            method,
            latencyMs: Date.now() - startedAtMs,
            publishRefreshApplied: opts.publishRefreshApplied === true,
          };
        }

        await sleep(CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readLocalCameraSnapshot],
  );

  const switchToWebCameraVideoSource = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      desiredFacing: VideoDateCameraFacingMode | null,
      expectedDeviceId?: string | null,
      restoreDeviceId = expectedDeviceId ?? before.deviceId,
    ): Promise<WebCameraSwitchCommit | null> => {
      if (typeof call.setInputDevicesAsync !== "function") return null;

      if (
        typeof navigator === "undefined" ||
        typeof navigator.mediaDevices?.getUserMedia !== "function"
      ) {
        return null;
      }

      let stream: MediaStream | null = null;
      let videoTrack: MediaStreamTrack | null = null;
      let dailyVideoInputCleared = false;
      let dailyVideoTrackAdopted = false;
      const restoreDailyVideoInput = async () => {
        try {
          call.setLocalVideo(true);
          if (!dailyVideoInputCleared) return true;
          if (!restoreDeviceId) return false;
          await call.setInputDevicesAsync({ videoDeviceId: restoreDeviceId });
          call.setLocalVideo(true);
          dailyVideoInputCleared = false;
          dailyVideoTrackAdopted = false;
          return true;
        } catch (restoreError) {
          vdbg("daily_camera_switch_video_source_restore_failed", {
            sessionId: activeCallSessionIdRef.current,
            eventId: optionsRef.current?.eventId ?? null,
            userId: optionsRef.current?.userId ?? null,
            platform: "web",
            desiredFacing,
            restoreDeviceId,
            error: describeCameraSwitchError(restoreError),
          });
          return false;
        }
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          videoOnlyCameraSwitchConstraints(
            captureProfileRef.current,
            desiredFacing,
            expectedDeviceId,
          ),
        );
        videoTrack = stream.getVideoTracks()[0] ?? null;
        if (!videoTrack) return null;
        await call.setInputDevicesAsync({ videoSource: false });
        dailyVideoInputCleared = true;
        await call.setInputDevicesAsync({ videoSource: videoTrack });
        dailyVideoTrackAdopted = true;
        call.setLocalVideo(true);
        const sourceCommit = await waitForLocalCameraSwitchCommit(
          call,
          before,
          "video_source",
          {
            expectedDeviceId: getTrackDeviceId(videoTrack),
            expectedFacing: getTrackFacingMode(videoTrack) ?? desiredFacing,
            publishRefreshApplied: true,
          },
        );
        if (sourceCommit) return sourceCommit;
        const restored = await restoreDailyVideoInput();
        if (restored || !dailyVideoTrackAdopted) videoTrack.stop();
        return null;
      } catch (error) {
        const restored = await restoreDailyVideoInput();
        if (restored || !dailyVideoTrackAdopted) videoTrack?.stop();
        vdbg("daily_camera_switch_video_source_fallback_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          error: describeCameraSwitchError(error),
        });
        return null;
      } finally {
        stream?.getAudioTracks().forEach((track) => track.stop());
      }
    },
    [waitForLocalCameraSwitchCommit],
  );

  const switchToDeterministicWebCamera = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      desiredFacing: VideoDateCameraFacingMode | null,
      opts: { forceVideoSourceRefresh?: boolean } = {},
    ): Promise<WebCameraSwitchCommit | null> => {
      if (typeof call.setInputDevicesAsync !== "function") return null;

      const devices = await enumerateWebVideoDevices(call);
      const device = chooseWebVideoDevice(devices, before, desiredFacing);
      const deviceId = getDeviceId(device);
      if (deviceId) {
        const sourceFacing = getDeviceFacingMode(device) ?? desiredFacing;
        await call.setInputDevicesAsync({ videoDeviceId: deviceId });
        const deviceCommit = await waitForLocalCameraSwitchCommit(
          call,
          before,
          "set_input_device",
          {
            expectedDeviceId: deviceId,
            expectedFacing: sourceFacing,
          },
        );
        if (deviceCommit && !opts.forceVideoSourceRefresh) return deviceCommit;
        const sourceCommit = await switchToWebCameraVideoSource(
          call,
          before,
          sourceFacing,
          deviceId,
        );
        if (sourceCommit) return sourceCommit;
        if (opts.forceVideoSourceRefresh) {
          const facingSourceCommit = await switchToWebCameraVideoSource(
            call,
            before,
            sourceFacing,
            null,
            deviceId,
          );
          if (facingSourceCommit) return facingSourceCommit;
        }
        if (deviceCommit) return deviceCommit;
      }

      return switchToWebCameraVideoSource(call, before, desiredFacing);
    },
    [switchToWebCameraVideoSource, waitForLocalCameraSwitchCommit],
  );

  // Hint is now a fire-and-forget signal. The receiver uses it to arm a
  // freshness watchdog over the same persistentTrack. No resend needed,
  // and the publishSequence / hintSequence retry protocol from the previous
  // (regression-prone) revisions is gone.
  const sendCommittedCameraSwitchHint = useCallback(
    async (call: DailyCall, commit: WebCameraSwitchCommit) => {
      if (typeof call.sendAppMessage !== "function") {
        vdbg("daily_camera_switch_render_hint_send_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          reason: "send_app_message_unavailable",
        });
        return;
      }

      const hint = createVideoDateCameraSwitchRenderHint({
        sourcePlatform: "web",
        facingMode: commit.facingMode,
        commitConfirmed: true,
        commitMethod: commit.method,
        localVideoTrackId: commit.trackId,
        commitLatencyMs: commit.latencyMs,
      });

      await Promise.resolve(call.sendAppMessage(hint));
      vdbg("daily_camera_switch_render_hint_sent", {
        sessionId: activeCallSessionIdRef.current,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        platform: "web",
        switchId: hint.switchId,
        facingMode: hint.facingMode,
        commitMethod: hint.commitMethod,
        localVideoTrackId: hint.localVideoTrackId,
        commitLatencyMs: hint.commitLatencyMs,
      });
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const co = callObjectRef.current;
      if (
        !co ||
        (typeof co.cycleCamera !== "function" &&
          typeof co.setInputDevicesAsync !== "function")
      ) {
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      try {
        const devices = await enumerateWebVideoDevices(co);
        if (!cancelled) setCanFlipCamera(!isVideoOff && devices.length > 1);
      } catch {
        if (!cancelled)
          setCanFlipCamera(!isVideoOff && typeof co.cycleCamera === "function");
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [isConnected, isVideoOff, localStream]);

  const flipCamera = useCallback(async () => {
    const co = callObjectRef.current;
    if (
      !co ||
      isFlippingCamera ||
      cameraSwitchInFlightRef.current ||
      isVideoOff
    )
      return;
    if (
      typeof co.cycleCamera !== "function" &&
      typeof co.setInputDevicesAsync !== "function"
    ) {
      setCanFlipCamera(false);
      return;
    }

    cameraSwitchInFlightRef.current = true;
    setIsFlippingCamera(true);
    try {
      const before = readLocalCameraSnapshot(co);
      const desiredFacing = oppositeCameraFacingMode(before.facingMode);
      const forceVideoSourceRefresh = isWebKitCameraSwitchRuntime();
      let commit: WebCameraSwitchCommit | null = null;

      try {
        commit = await switchToDeterministicWebCamera(
          co,
          before,
          desiredFacing,
          {
            forceVideoSourceRefresh,
          },
        );
      } catch (error) {
        vdbg("daily_camera_switch_deterministic_publish_refresh_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          forceVideoSourceRefresh,
          error: describeCameraSwitchError(error),
        });
      }

      if (!commit && typeof co.cycleCamera === "function") {
        const result = await co.cycleCamera({
          preferDifferentFacingMode: true,
        });
        const resultDevice = result?.device as
          | WebCameraDevice
          | null
          | undefined;
        commit = await waitForLocalCameraSwitchCommit(
          co,
          before,
          "cycle_camera",
          {
            expectedDeviceId: getDeviceId(resultDevice),
            expectedFacing: getDeviceFacingMode(resultDevice) ?? desiredFacing,
          },
        );
      }

      if (!commit) {
        const after = readLocalCameraSnapshot(co);
        vdbg("daily_camera_switch_commit_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          forceVideoSourceRefresh,
          before,
          after,
        });
        trackEvent("video_date_camera_switch_commit_failed", {
          platform: "web",
          session_id: activeCallSessionIdRef.current,
          event_id: optionsRef.current?.eventId ?? null,
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
        platform: "web",
        session_id: activeCallSessionIdRef.current,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_call",
        source_action: "camera_switch_committed",
        method: commit.method,
        facing_mode: commit.facingMode,
        local_video_track_id: commit.trackId,
        local_video_device_id: commit.deviceId,
        commit_latency_ms: commit.latencyMs,
        publish_refresh_applied: commit.publishRefreshApplied,
      });

      try {
        await sendCommittedCameraSwitchHint(co, commit);
      } catch (hintError) {
        vdbg("daily_camera_switch_render_hint_send_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          commitMethod: commit.method,
          error: describeCameraSwitchError(hintError),
        });
      }
    } catch (error) {
      trackEvent("video_date_flip_camera_failed", {
        platform: "web",
        session_id: activeCallSessionIdRef.current,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_call",
        source_action: "flip_camera_failed",
        reason_code: error instanceof Error ? error.name : "unknown",
      });
      vdbg("daily_camera_flip_failed", {
        sessionId: activeCallSessionIdRef.current,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        platform: "web",
        error: describeCameraSwitchError(error),
      });
    } finally {
      cameraSwitchInFlightRef.current = false;
      setIsFlippingCamera(false);
    }
  }, [
    isFlippingCamera,
    isVideoOff,
    readLocalCameraSnapshot,
    sendCommittedCameraSwitchHint,
    switchToDeterministicWebCamera,
    waitForLocalCameraSwitchCommit,
  ]);
  return {
    readLocalCameraSnapshot,
    waitForLocalCameraSwitchCommit,
    switchToWebCameraVideoSource,
    switchToDeterministicWebCamera,
    sendCommittedCameraSwitchHint,
    flipCamera,
  };
}

export type WebCameraSwitchApi = ReturnType<typeof useWebCameraSwitch>;
