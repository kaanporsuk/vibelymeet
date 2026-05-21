import { useEffect, useMemo, useState } from "react";
import {
  VIDEO_DATE_READINESS_BLOCKED_COPY,
  resolveVideoDateReadinessGate,
  type VideoDateReadinessStatus,
} from "@clientShared/matching/videoDateReadinessV2";
import { recordVideoDateReadinessCheckV2 } from "@/lib/videoDateReadiness";

type WebPermissionState = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

type NonBlockingReadiness = {
  status: VideoDateReadinessStatus;
  canAttemptPairing: boolean;
  reason: string | null;
  checked: boolean;
};

const initialReadiness: NonBlockingReadiness = {
  status: "unchecked",
  canAttemptPairing: true,
  reason: null,
  checked: false,
};

export function useNonBlockingVideoDateReadiness(
  eventId: string | undefined,
  enabled: boolean,
): NonBlockingReadiness {
  const [status, setStatus] = useState<VideoDateReadinessStatus>("unchecked");
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled || !eventId) {
      setStatus("unchecked");
      setChecked(false);
      return;
    }

    let cancelled = false;
    const inspect = async () => {
      const capabilities = await inspectWebVideoDateCapabilities();
      const nextStatus = resolveWebReadinessStatus(capabilities);
      if (cancelled) return;
      setStatus(nextStatus);
      setChecked(true);
      void recordVideoDateReadinessCheckV2({
        eventId,
        status: nextStatus,
        capabilities,
        clientPlatform: "web",
      });
    };

    void inspect();
    if (typeof document === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const onVisibilityChange = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      void inspect();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, eventId]);

  return useMemo(() => {
    if (!checked) return initialReadiness;
    const gate = resolveVideoDateReadinessGate(status);
    return {
      status,
      canAttemptPairing: gate.canAttemptPairing,
      reason: gate.reason,
      checked,
    };
  }, [checked, status]);
}

async function inspectWebVideoDateCapabilities(): Promise<Record<string, unknown>> {
  const mediaDevicesSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices);
  const getUserMediaSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const permissionsSupported = typeof navigator !== "undefined" && Boolean(navigator.permissions?.query);
  const [cameraPermission, microphonePermission] = await Promise.all([
    queryPermissionState("camera"),
    queryPermissionState("microphone"),
  ]);
  const devices = await enumerateMediaDevices();
  return {
    mediaDevicesSupported,
    getUserMediaSupported,
    permissionsSupported,
    cameraPermission,
    microphonePermission,
    hasCameraDevice: devices.hasCameraDevice,
    hasMicrophoneDevice: devices.hasMicrophoneDevice,
    deviceEnumerationSupported: devices.supported,
    diagnosticRoomPathDefined: true,
  };
}

async function queryPermissionState(name: "camera" | "microphone"): Promise<WebPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

async function enumerateMediaDevices(): Promise<{
  supported: boolean;
  hasCameraDevice: boolean | null;
  hasMicrophoneDevice: boolean | null;
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return { supported: false, hasCameraDevice: null, hasMicrophoneDevice: null };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      supported: true,
      hasCameraDevice: devices.some((device) => device.kind === "videoinput"),
      hasMicrophoneDevice: devices.some((device) => device.kind === "audioinput"),
    };
  } catch {
    return { supported: true, hasCameraDevice: null, hasMicrophoneDevice: null };
  }
}

function resolveWebReadinessStatus(capabilities: Record<string, unknown>): VideoDateReadinessStatus {
  if (capabilities.getUserMediaSupported !== true) return "blocked";
  if (capabilities.cameraPermission === "denied" || capabilities.microphonePermission === "denied") return "blocked";
  const permissionsGranted =
    capabilities.cameraPermission === "granted" &&
    capabilities.microphonePermission === "granted";
  if (
    permissionsGranted &&
    (capabilities.hasCameraDevice === false || capabilities.hasMicrophoneDevice === false)
  ) {
    return "blocked";
  }
  if (capabilities.cameraPermission === "granted" && capabilities.microphonePermission === "granted") return "ready";
  return "warning";
}

export { VIDEO_DATE_READINESS_BLOCKED_COPY };
