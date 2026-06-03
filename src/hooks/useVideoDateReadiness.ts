import { useEffect, useMemo, useState } from "react";
import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import {
  VIDEO_DATE_READINESS_BLOCKED_COPY,
  resolveVideoDateReadinessDiagnostic,
  shouldRunVideoDateDiagnostic,
  type VideoDateReadinessStatus,
} from "@clientShared/matching/videoDateReadinessV2";
import {
  prepareVideoDateDiagnosticEntry,
  recordVideoDateReadinessCheckV2,
} from "@/lib/videoDateReadiness";
import {
  createDailyCallObjectGuarded,
  registerWebVideoDateDailyCleanup,
} from "@/lib/dailyCallInstance";

type WebPermissionState = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

type NonBlockingReadiness = {
  status: VideoDateReadinessStatus;
  diagnosticMessage: string | null;
  checked: boolean;
};

const initialReadiness: NonBlockingReadiness = {
  status: "unchecked",
  diagnosticMessage: null,
  checked: false,
};
const diagnosticLastRunAtMsByEvent = new Map<string, number>();
const DAILY_CALL_QUALITY_TIMEOUT_MS = 16_000;
const DAILY_DIAGNOSTIC_PREAUTH_TIMEOUT_MS = 5_000;

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
      }).catch(() => undefined);
      void maybeRunDiagnostic(eventId, nextStatus, capabilities, () => cancelled);
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
    const diagnostic = resolveVideoDateReadinessDiagnostic(status);
    return {
      status,
      diagnosticMessage: diagnostic.diagnosticMessage,
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

async function maybeRunDiagnostic(
  eventId: string,
  status: VideoDateReadinessStatus,
  capabilities: Record<string, unknown>,
  isCancelled: () => boolean,
) {
  const nowMs = Date.now();
  if (!shouldRunVideoDateDiagnostic(status, diagnosticLastRunAtMsByEvent.get(eventId), nowMs)) return;
  diagnosticLastRunAtMsByEvent.set(eventId, nowMs);
  let diagnostic: Awaited<ReturnType<typeof prepareVideoDateDiagnosticEntry>>;
  try {
    diagnostic = await prepareVideoDateDiagnosticEntry();
  } catch {
    diagnostic = { ok: false, error: "diagnostic_entry_exception", retryable: true };
  }
  if (isCancelled()) return;
  const dailyDiagnostic = diagnostic.ok === true
    ? {
        ok: true,
        roomNamePresent: Boolean(diagnostic.roomName),
        roomUrlPresent: Boolean(diagnostic.roomUrl),
        tokenReceived: true,
        tokenTtlSeconds: diagnostic.tokenTtlSeconds,
        callQuality: await runDailyCallQualityAdvisory(diagnostic),
      }
    : {
        ok: false,
        error: diagnostic.error,
        retryable: diagnostic.retryable,
      };
  void recordVideoDateReadinessCheckV2({
    eventId,
    status,
    capabilities: {
      ...capabilities,
      dailyDiagnostic,
    },
    clientPlatform: "web",
  }).catch(() => undefined);
}

async function runDailyCallQualityAdvisory(
  diagnostic: Extract<Awaited<ReturnType<typeof prepareVideoDateDiagnosticEntry>>, { ok: true }>,
): Promise<Record<string, unknown>> {
  if (typeof window === "undefined") return { ok: false, skipped: "window_unavailable" };
  const startedAt = Date.now();
  let call: DailyCall | null = null;
  try {
    const guarded = await createDailyCallObjectGuarded(
      DailyIframe,
      { audioSource: false, videoSource: false },
      {
        source: "web_video_date_readiness_diagnostic",
        skipIfCleanupPending: true,
        waitForCleanup: false,
        failOnExternalCall: true,
      },
    );
    if (guarded.ok === false) {
      return {
        ok: false,
        skipped: guarded.reason,
        meetingState: guarded.meetingState ?? null,
        latencyMs: Date.now() - startedAt,
      };
    }
    call = guarded.call;
    if (typeof call.preAuth !== "function") {
      return { ok: false, skipped: "preauth_api_unavailable", latencyMs: Date.now() - startedAt };
    }
    const diagnosticToken = diagnostic.token;
    const preAuthReady = await withTimeout(
      Promise.resolve(call.preAuth({ url: diagnostic.roomUrl, token: diagnosticToken })).then(
        () => true,
        () => false,
      ),
      DAILY_DIAGNOSTIC_PREAUTH_TIMEOUT_MS,
    );
    if (preAuthReady !== true) {
      return {
        ok: false,
        skipped: preAuthReady === null ? "preauth_timeout" : "preauth_failed",
        latencyMs: Date.now() - startedAt,
      };
    }
    if (typeof call.testCallQuality !== "function") {
      return { ok: false, error: "call_quality_api_unavailable", latencyMs: Date.now() - startedAt };
    }
    const result = await withTimeout(
      Promise.resolve(call.testCallQuality()),
      DAILY_CALL_QUALITY_TIMEOUT_MS,
    );
    if (!result) {
      call.stopTestCallQuality?.();
      return { ok: false, error: "call_quality_timeout", latencyMs: Date.now() - startedAt };
    }
    return {
      ok: true,
      api: "testCallQuality",
      latencyMs: Date.now() - startedAt,
      ...summarizeDailyQualityResult(result),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.name || error.message : "call_quality_failed",
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    if (call) {
      try {
        await registerWebVideoDateDailyCleanup(
          Promise.resolve().then(async () => {
            await Promise.resolve(call?.destroy());
          }),
          {
            source: "web_video_date_readiness_diagnostic",
            reason: "diagnostic_complete",
          },
        );
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function summarizeDailyQualityResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return { result: "unknown" };
  const record = result as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  return {
    result: typeof record.result === "string" ? record.result : "unknown",
    secondsElapsed: typeof record.secondsElapsed === "number" ? record.secondsElapsed : null,
    maxRoundTripTime: typeof data.maxRoundTripTime === "number" ? data.maxRoundTripTime : null,
    avgRoundTripTime: typeof data.avgRoundTripTime === "number" ? data.avgRoundTripTime : null,
    avgSendPacketLoss: typeof data.avgSendPacketLoss === "number" ? data.avgSendPacketLoss : null,
    avgAvailableOutgoingBitrate: typeof data.avgAvailableOutgoingBitrate === "number"
      ? data.avgAvailableOutgoingBitrate
      : null,
    avgSendBitsPerSecond: typeof data.avgSendBitsPerSecond === "number" ? data.avgSendBitsPerSecond : null,
  };
}

export { VIDEO_DATE_READINESS_BLOCKED_COPY };
