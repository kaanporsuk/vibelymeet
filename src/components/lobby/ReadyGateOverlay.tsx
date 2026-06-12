import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import * as Sentry from "@sentry/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, Clock, Sparkles, X } from "lucide-react";
import { useReadyGate } from "@/hooks/useReadyGate";
import { vdbg } from "@/lib/vdbg";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { prepareVideoDateEntry } from "@/lib/videoDatePrepareEntry";
import { updateVideoDateEntryOwnerState } from "@clientShared/matching/videoDateEntryOwner";
import { preloadRoute } from "@/lib/routePreload";
import { videoDateWebMediaStreamConstraints } from "@/lib/dailyCallObjectConfig";
import {
  destroyWebVideoDateDailyPrewarm,
  preAuthWebVideoDateDailyPrewarm,
  startWebVideoDateDailyPrewarm,
} from "@/lib/videoDateDailyPrewarm";
import {
  clearWebVideoDateMediaHandoff,
  setWebVideoDateMediaHandoff,
} from "@/lib/videoDateMediaHandoff";
import { fetchVideoDatePartnerProfile } from "@/lib/videoDatePartnerProfile";
import { fetchVideoDateStartSnapshot } from "@/lib/videoDateStartSnapshot";
import { fetchVideoSessionDateEntryTruthCoalesced } from "@/lib/videoDateSessionTruth";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { toast } from "sonner";
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from "@shared/matching/videoSessionFlow";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { EventLobbyObservabilityEvents } from "@clientShared/observability/eventLobbyObservability";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
  startReadyGateToDateLatencyContext,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  getVideoDatePermissionHandoff,
  setVideoDatePermissionHandoff,
} from "@clientShared/matching/videoDatePermissionHandoff";
import {
  VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER,
  isVideoDateCameraConstraintError,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import { classifyMediaPermissionErrorWithBrowserState } from "@clientShared/media/mediaPermissionResult";
import {
  getReadyGateCountdownProgress,
  getReadyGateCountdownFromServerClock,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from "@clientShared/matching/readyGateCountdown";
import {
  VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS,
  VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
  getVideoDateEntryHandoffRetryDelayMs,
  getVideoDateEntryHandoffStatusCopy,
  shouldRetryVideoDateEntryHandoffFailure,
  type VideoDateEntryHandoffStatus,
} from "@clientShared/matching/videoDateEntryRetryPolicy";
import {
  isReadyGatePrepareEntryNonRetryable,
  type ReadyGateTerminalRecoveryInput,
} from "@clientShared/matching/readyGateTerminalRecovery";
import {
  adviseVideoSessionTruthRecovery,
  resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery,
} from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  getReadyGatePermissionPrewarmReleaseDelayMs,
  getReadyGateReadinessStatusCopy,
} from "@clientShared/matching/readyGateReadiness";
import { READY_GATE_REALTIME_RECOVERY_STABLE_MS } from "@clientShared/matching/readyGateRealtimeSupervisor";
import {
  resolveReadyGateDiagnosticChecklist,
  resolveReadyGatePrepareEntryFailureCopy,
  resolveReadyGateTransitionFailureCopy,
  type ReadyGateDiagnosticCopy,
  type ReadyGateDiagnosticStatus,
} from "@clientShared/matching/readyGateDiagnosticCopy";

interface ReadyGateOverlayProps {
  sessionId: string;
  eventId: string;
  onClose: () => void;
  onNavigateToDate: (sessionId: string, source: string) => void;
  onManualExitConfirmed?: (sessionId: string) => void;
}

const GATE_TIMEOUT = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const ACTIVE_DATE_QUEUE_STATUSES = new Set(["in_handshake", "in_date"]);
const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;
const READY_GATE_DEGRADED_SYNC_POLL_MS = 2_500;
const READY_GATE_RECONCILE_TIMEOUT_COOLDOWN_MS = 3_000;
const READY_GATE_PERMISSION_PREWARM_TIMEOUT_MS = 15_000;

type PrepareEntryStatus = VideoDateEntryHandoffStatus;
type ReadyGateTerminalAction =
  | "skip_this_one"
  | "cancel_go_back"
  | "prepare_failed_back";

type PrepareEntryFailureState = {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
} | null;

type ReadyGatePermissionPrewarmMedia = {
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  acquiredAtMs: number;
  source: string;
};

class ReadyGatePermissionPrewarmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`ready_gate_permission_prewarm_timeout_${timeoutMs}ms`);
    this.name = "ReadyGatePermissionPrewarmTimeoutError";
  }
}

function isReadyGatePermissionPrewarmTimeoutError(
  error: unknown,
): error is ReadyGatePermissionPrewarmTimeoutError {
  return error instanceof ReadyGatePermissionPrewarmTimeoutError;
}

async function withReadyGatePermissionPrewarmTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ReadyGatePermissionPrewarmTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type ReadyGateMediaDiagnosticState = {
  cameraPermissionStatus: ReadyGateDiagnosticStatus;
  microphonePermissionStatus: ReadyGateDiagnosticStatus;
  cameraDeviceStatus: ReadyGateDiagnosticStatus;
  microphoneDeviceStatus: ReadyGateDiagnosticStatus;
};

const READY_GATE_MEDIA_DIAGNOSTICS_CHECKING: ReadyGateMediaDiagnosticState = {
  cameraPermissionStatus: "checking",
  microphonePermissionStatus: "checking",
  cameraDeviceStatus: "unknown",
  microphoneDeviceStatus: "unknown",
};

function stopMediaStreamTracks(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore track-stop errors */
    }
  }
}

function firstLiveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  return tracks.find((track) => track.readyState !== "ended") ?? null;
}

function assertLiveVideoDateCameraAndMicrophone(stream: MediaStream, source: string) {
  if (!firstLiveTrack(stream.getVideoTracks())) {
    throw new Error(`${source} returned no live video track`);
  }
  if (!firstLiveTrack(stream.getAudioTracks())) {
    throw new Error(`${source} returned no live audio track`);
  }
}

function hasLabeledDevice(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
): boolean {
  return devices.some(
    (device) => device.kind === kind && device.label.trim().length > 0,
  );
}

async function hasPriorGrantedVideoDateDeviceLabels(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  )
    return false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return (
    hasLabeledDevice(devices, "videoinput") &&
    hasLabeledDevice(devices, "audioinput")
  );
}

function isVideoDateCaptureStartError(error: unknown): boolean {
  // iOS WebKit frequently rejects getUserMedia with these "could not start the
  // source" errors when the requested capture profile is too specific (exact
  // resolution / frameRate / aspectRatio); retrying with a simpler profile —
  // down to bare facingMode — usually succeeds. NotAllowedError is intentionally
  // excluded so a genuine denial surfaces instead of being retried.
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return ["AbortError", "NotReadableError", "TrackStartError"].includes(name);
}

async function getVideoDatePermissionPrewarmStream(): Promise<ReadyGatePermissionPrewarmMedia> {
  let lastConstraintError: unknown = null;
  for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        videoDateWebMediaStreamConstraints(profile),
      );
      try {
        assertLiveVideoDateCameraAndMicrophone(stream, "Ready Gate permission prewarm");
      } catch (error) {
        stopMediaStreamTracks(stream);
        throw error;
      }
      return {
        stream,
        captureProfile: profile,
        acquiredAtMs: Date.now(),
        source: "ready_gate_permission_prewarm",
      };
    } catch (error) {
      const retryableWithSimplerProfile =
        isVideoDateCameraConstraintError(error) ||
        isVideoDateCaptureStartError(error);
      if (!retryableWithSimplerProfile || profile === "fallback") throw error;
      lastConstraintError = error;
    }
  }
  throw (
    lastConstraintError ??
    new Error("No Video Date media capture profile available")
  );
}

function resolveWebMediaPermissionDiagnosticStatus(
  state: PermissionState | null,
  hasGrantedLabel: boolean,
): ReadyGateDiagnosticStatus {
  // A non-empty device label is only exposed for a media kind the page already
  // has permission to use, so it is a reliable cross-browser "already granted"
  // signal — critically on iOS WebKit (Safari and iOS Chrome), where
  // navigator.permissions.query({ name: "camera" | "microphone" }) is
  // unsupported and always resolves to null.
  if (state === "granted" || hasGrantedLabel) return "ok";
  if (state === "denied") return "blocked";
  // Not provably granted and not denied: surface the actionable "Allow …" prompt
  // affordance (the "warning" row renders an "Allow camera"/"Allow microphone"
  // button) rather than a passive, non-actionable "checking" row, so the user
  // always has a way to trigger the permission prompt.
  return "warning";
}

async function queryWebMediaPermissionState(
  name: "camera" | "microphone",
): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query)
    return null;
  try {
    const status = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return status.state;
  } catch {
    return null;
  }
}

async function inspectWebReadyGateMediaDiagnostics(): Promise<ReadyGateMediaDiagnosticState> {
  const [cameraPermission, microphonePermission] = await Promise.all([
    queryWebMediaPermissionState("camera"),
    queryWebMediaPermissionState("microphone"),
  ]);

  let enumerated = false;
  let hasCameraDevice = false;
  let hasMicrophoneDevice = false;
  let cameraLabelGranted = false;
  let microphoneLabelGranted = false;

  if (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.enumerateDevices
  ) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      enumerated = true;
      hasCameraDevice = devices.some((device) => device.kind === "videoinput");
      hasMicrophoneDevice = devices.some(
        (device) => device.kind === "audioinput",
      );
      cameraLabelGranted = hasLabeledDevice(devices, "videoinput");
      microphoneLabelGranted = hasLabeledDevice(devices, "audioinput");
    } catch {
      enumerated = false;
    }
  }

  const cameraPermissionStatus = resolveWebMediaPermissionDiagnosticStatus(
    cameraPermission,
    cameraLabelGranted,
  );
  const microphonePermissionStatus = resolveWebMediaPermissionDiagnosticStatus(
    microphonePermission,
    microphoneLabelGranted,
  );

  return {
    cameraPermissionStatus,
    microphonePermissionStatus,
    // Only assert a green device row once the permission proves usable; before
    // that we cannot truly verify capture, so stay neutral instead of pairing a
    // green "Camera"/"Microphone" row next to an un-granted permission row.
    cameraDeviceStatus:
      cameraPermissionStatus !== "ok"
        ? "unknown"
        : !enumerated || hasCameraDevice
          ? "ok"
          : "failed",
    microphoneDeviceStatus:
      microphonePermissionStatus !== "ok"
        ? "unknown"
        : !enumerated || hasMicrophoneDevice
          ? "ok"
          : "failed",
  };
}

async function mediaDiagnosticFromPrewarmError(
  error: unknown,
): Promise<Partial<ReadyGateMediaDiagnosticState>> {
  const permissionResult = await classifyMediaPermissionErrorWithBrowserState(
    error,
    "camera_microphone",
  );
  if (permissionResult.status === "denied") {
    return {
      cameraPermissionStatus: "blocked",
      microphonePermissionStatus: "blocked",
    };
  }
  if (permissionResult.status === "missing_device") {
    return {
      cameraDeviceStatus: "failed",
      microphoneDeviceStatus: "failed",
    };
  }
  if (
    permissionResult.status === "constraint_failed" ||
    isVideoDateCameraConstraintError(error)
  ) {
    return {
      cameraDeviceStatus: "failed",
    };
  }
  return {
    cameraPermissionStatus: "warning",
    microphonePermissionStatus: "warning",
  };
}

function mergeInspectedDiagnosticStatus(
  inspectedStatus: ReadyGateDiagnosticStatus,
  fallbackStatus: ReadyGateDiagnosticStatus | undefined,
): ReadyGateDiagnosticStatus {
  // The fallback is derived from the just-observed getUserMedia failure (ground
  // truth). A definitive failure (blocked/failed) must surface even when the
  // current-state inspection is only a soft guess ("warning" = "permission
  // unreadable on this browser, offer the prompt" / "unknown" / "checking").
  // Otherwise a real denial or device failure is masked as a still-promptable
  // row that just re-runs a getUserMedia the OS will silently reject.
  if (
    (fallbackStatus === "blocked" || fallbackStatus === "failed") &&
    inspectedStatus !== "ok" &&
    inspectedStatus !== "blocked" &&
    inspectedStatus !== "failed"
  ) {
    return fallbackStatus;
  }
  return inspectedStatus === "unknown" && fallbackStatus
    ? fallbackStatus
    : inspectedStatus;
}

function mergeRefreshedDiagnosticStatus(
  inspectedStatus: ReadyGateDiagnosticStatus,
  currentStatus: ReadyGateDiagnosticStatus,
): ReadyGateDiagnosticStatus {
  if (inspectedStatus !== "unknown") return inspectedStatus;
  if (currentStatus === "checking") return "unknown";
  return currentStatus;
}

async function resolveMediaDiagnosticsAfterPrewarmError(
  error: unknown,
): Promise<ReadyGateMediaDiagnosticState> {
  const [fallback, inspected] = await Promise.all([
    mediaDiagnosticFromPrewarmError(error),
    inspectWebReadyGateMediaDiagnostics(),
  ]);
  return {
    cameraPermissionStatus: mergeInspectedDiagnosticStatus(
      inspected.cameraPermissionStatus,
      fallback.cameraPermissionStatus,
    ),
    microphonePermissionStatus: mergeInspectedDiagnosticStatus(
      inspected.microphonePermissionStatus,
      fallback.microphonePermissionStatus,
    ),
    cameraDeviceStatus: mergeInspectedDiagnosticStatus(
      inspected.cameraDeviceStatus,
      fallback.cameraDeviceStatus,
    ),
    microphoneDeviceStatus: mergeInspectedDiagnosticStatus(
      inspected.microphoneDeviceStatus,
      fallback.microphoneDeviceStatus,
    ),
  };
}

type ReadyGateTerminalDetail = {
  status?: string | null;
  reason?: string | null;
  inactiveReason?: string | null;
  errorCode?: string | null;
  code?: string | null;
  terminal?: boolean | null;
};

function readyGateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[ReadyGateOverlay] ${message}`, data ?? {});
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function prepareEntryFailureMessage(code?: string): string {
  return resolveReadyGatePrepareEntryFailureCopy({ code, platform: "web" })
    .message;
}

function prepareEntryTransitionCopy(
  status: PrepareEntryStatus,
  failure: PrepareEntryFailureState,
) {
  return getVideoDateEntryHandoffStatusCopy(status, failure?.message);
}

type VideoSessionDateEntryTruth = Awaited<
  ReturnType<typeof fetchVideoSessionDateEntryTruthCoalesced>
>;

function isTerminalReadyGateTruth(truth: VideoSessionDateEntryTruth): boolean {
  if (truth === undefined) return false;
  if (truth === null) return true;
  if (truth.ended_at) return true;
  if (truth.state === "ended" || truth.phase === "ended") return true;
  return (
    truth.ready_gate_status === "expired" ||
    truth.ready_gate_status === "forfeited" ||
    truth.ready_gate_status === "cancelled" ||
    truth.ready_gate_status === "skipped"
  );
}

function isRouteableVideoDateTruth(truth: VideoSessionDateEntryTruth): boolean {
  if (truth === undefined || truth === null) return false;
  if (isTerminalReadyGateTruth(truth)) return false;
  return (
    truth.state === "entry" ||
    truth.state === "date" ||
    truth.phase === "entry" ||
    truth.phase === "date" ||
    truth.entry_started_at !== null ||
    truth.date_started_at !== null
  );
}

function isReadyGateTransitionTimeoutSignal(input: {
  code?: string | null;
  errorCode?: string | null;
  reason?: string | null;
  error?: string | null;
  details?: string | null;
  retryable?: boolean | null;
}): boolean {
  if (input.retryable === true) return true;
  const text = [
    input.code,
    input.errorCode,
    input.reason,
    input.error,
    input.details,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    text.includes("57014") ||
    text.includes("statement timeout") ||
    text.includes("canceling statement") ||
    text.includes("cancelled on user request")
  );
}

function isReadyGateReadyProgressStatus(status?: string | null): boolean {
  return (
    status === "ready" ||
    status === "ready_a" ||
    status === "ready_b" ||
    status === "both_ready"
  );
}


const ReadyGateOverlay = ({
  sessionId,
  eventId,
  onClose,
  onNavigateToDate,
  onManualExitConfirmed,
}: ReadyGateOverlayProps) => {
  const { user } = useUserProfile();
  const prefersReducedMotion = useReducedMotion();

  const [partnerPhotos, setPartnerPhotos] = useState<string[] | null>(null);
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(null);
  const [sharedVibes, setSharedVibes] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [prepareEntryStatus, setPrepareEntryStatus] =
    useState<PrepareEntryStatus>("idle");
  const [prepareEntryFailure, setPrepareEntryFailure] =
    useState<PrepareEntryFailureState>(null);
  const [mediaDiagnostics, setMediaDiagnostics] =
    useState<ReadyGateMediaDiagnosticState>(
      READY_GATE_MEDIA_DIAGNOSTICS_CHECKING,
    );
  const [showRealtimeFallbackCopy, setShowRealtimeFallbackCopy] =
    useState(false);
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(
    null,
  );
  const closedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const invalidCloseToastRef = useRef(false);
  const readyGateImpressionRef = useRef(false);
  const openingWaitImpressionRef = useRef(false);
  const terminalOutcomeRef = useRef(false);
  const expirySyncInFlightRef = useRef(false);
  const expirySyncRetryAtMsRef = useRef(0);
  const activeReadyGateKey = `${sessionId}:${eventId}`;
  const activeReadyGateKeyRef = useRef(activeReadyGateKey);
  const bothReadyObservedAtMsRef = useRef<number | null>(null);
  const readyGateOpenedAtMsRef = useRef(Date.now());
  const prepareEntryHandoffStartedRef = useRef(false);
  const permissionPrewarmStartedRef = useRef(false);
  const permissionPrewarmMediaRef =
    useRef<ReadyGatePermissionPrewarmMedia | null>(null);
  const permissionPrewarmCapturePendingRef =
    useRef<Promise<ReadyGatePermissionPrewarmMedia> | null>(null);
  const permissionPrewarmCaptureConsumerTokenRef = useRef(0);
  const permissionPrewarmMediaHandoffStoredRef = useRef(false);
  const permissionPrewarmMediaReleaseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const permissionPrewarmSkipLoggedRef = useRef(false);
  // Records the outcome of the most recent runPermissionPrewarm() call so the
  // "I'm Ready" gate can choose between settings guidance and an in-place retry
  // prompt without ever marking ready before live camera + microphone are proven.
  const lastPermissionPrewarmOutcomeRef = useRef<
    "granted" | "denied" | "transient" | null
  >(null);
  const prepareEntryRunIdRef = useRef(0);
  const realtimeFallbackLoggedRef = useRef(false);
  const readyGateRealtimeDegradedLoggedRef = useRef(false);
  const overlayRealtimeDegradedRef = useRef(false);
  const orchestratorRealtimeDegradedRef = useRef(false);
  const realtimeFallbackCopyTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const overlayRealtimeRecoveryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const terminalActionInFlightRef = useRef(false);
  const readyActionInFlightRef = useRef(false);
  const reconcileSessionInFlightRef = useRef(false);
  const reconcileSessionCooldownUntilMsRef = useRef(0);
  const manualExitRequestedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const duplicateNavSuppressionKeysRef = useRef<Set<string>>(new Set());
  const duplicateTerminalSuppressionKeysRef = useRef<Set<string>>(new Set());
  const terminalToastKeyRef = useRef<string | null>(null);
  const nonRetryablePrepareFailureRef = useRef<string | null>(null);
  const latestUnmountCleanupContextRef = useRef({
    sessionId,
    eventId,
    userId: user?.id ?? null,
  });

  const trackReadyGateClientEvent = useCallback(
    (eventName: string, payload: Record<string, unknown>) => {
      trackEvent(eventName, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "ready_gate_overlay",
        ...payload,
      });
    },
    [eventId, sessionId],
  );

  const clearPermissionPrewarmMediaReleaseTimer = useCallback(() => {
    if (!permissionPrewarmMediaReleaseTimerRef.current) return;
    clearTimeout(permissionPrewarmMediaReleaseTimerRef.current);
    permissionPrewarmMediaReleaseTimerRef.current = null;
  }, []);

  const clearRealtimeFallbackCopy = useCallback(() => {
    setShowRealtimeFallbackCopy(false);
    if (realtimeFallbackCopyTimerRef.current) {
      clearTimeout(realtimeFallbackCopyTimerRef.current);
      realtimeFallbackCopyTimerRef.current = null;
    }
  }, []);

  const clearOverlayRealtimeRecoveryTimer = useCallback(() => {
    if (!overlayRealtimeRecoveryTimerRef.current) return;
    clearTimeout(overlayRealtimeRecoveryTimerRef.current);
    overlayRealtimeRecoveryTimerRef.current = null;
  }, []);

  const clearRealtimeDegradedWhenHealthy = useCallback(() => {
    if (
      overlayRealtimeDegradedRef.current ||
      orchestratorRealtimeDegradedRef.current
    )
      return;
    setRealtimeDegraded(false);
    clearRealtimeFallbackCopy();
  }, [clearRealtimeFallbackCopy]);

  const scheduleOverlayRealtimeRecovery = useCallback(() => {
    clearOverlayRealtimeRecoveryTimer();
    overlayRealtimeRecoveryTimerRef.current = setTimeout(() => {
      overlayRealtimeRecoveryTimerRef.current = null;
      overlayRealtimeDegradedRef.current = false;
      clearRealtimeDegradedWhenHealthy();
    }, READY_GATE_REALTIME_RECOVERY_STABLE_MS);
  }, [clearOverlayRealtimeRecoveryTimer, clearRealtimeDegradedWhenHealthy]);

  const releasePermissionPrewarmMedia = useCallback(
    (reason: string) => {
      const media = permissionPrewarmMediaRef.current;
      clearPermissionPrewarmMediaReleaseTimer();
      if (!media) return;
      permissionPrewarmMediaRef.current = null;
      if (user?.id) {
        clearWebVideoDateMediaHandoff(sessionId, user.id);
      }
      permissionPrewarmMediaHandoffStoredRef.current = false;
      stopMediaStreamTracks(media.stream);
      vdbg("ready_gate_permission_prewarm_media_released", {
        sessionId,
        eventId,
        captureProfile: media.captureProfile,
        source: media.source,
        reason,
        ageMs: Math.max(0, Date.now() - media.acquiredAtMs),
      });
    },
    [clearPermissionPrewarmMediaReleaseTimer, eventId, sessionId, user?.id],
  );

  const cancelTerminalReadyGateWork = useCallback(
    (reason: string) => {
      prepareEntryRunIdRef.current += 1;
      prepareEntryHandoffStartedRef.current = false;
      clearOverlayRealtimeRecoveryTimer();
      clearRealtimeFallbackCopy();
      releasePermissionPrewarmMedia(reason);
      if (user?.id) {
        destroyWebVideoDateDailyPrewarm(sessionId, user.id, reason);
        clearWebVideoDateMediaHandoff(sessionId, user.id);
      }
    },
    [
      clearOverlayRealtimeRecoveryTimer,
      clearRealtimeFallbackCopy,
      releasePermissionPrewarmMedia,
      sessionId,
      user?.id,
    ],
  );

  useLayoutEffect(() => {
    activeReadyGateKeyRef.current = activeReadyGateKey;
  }, [activeReadyGateKey]);

  useLayoutEffect(() => {
    latestUnmountCleanupContextRef.current = {
      sessionId,
      eventId,
      userId: user?.id ?? null,
    };
  }, [eventId, sessionId, user?.id]);

  const addReadyGateBreadcrumb = useCallback(
    (message: string, data?: Record<string, unknown>) => {
      Sentry.addBreadcrumb({
        category: "ready-gate",
        level: "info",
        message,
        data: {
          sessionId,
          eventId,
          ...data,
        },
      });
    },
    [eventId, sessionId],
  );

  const suppressDuplicateNav = useCallback(
    (source: string) => {
      const key = `${sessionId}:${source}`;
      if (duplicateNavSuppressionKeysRef.current.has(key)) return;
      duplicateNavSuppressionKeysRef.current.add(key);
      trackReadyGateClientEvent(
        LobbyPostDateEvents.READY_GATE_CLIENT_DUPLICATE_NAV_SUPPRESSED,
        {
          source,
          source_action: source,
          ready_gate_status: "both_ready",
          reason: "navigation_already_started",
          terminal: false,
        },
      );
      addReadyGateBreadcrumb("duplicate_date_navigation_suppressed", {
        source,
      });
    },
    [addReadyGateBreadcrumb, sessionId, trackReadyGateClientEvent],
  );

  const suppressDuplicateTerminal = useCallback(
    (source: string, recoveryInput?: ReadyGateTerminalRecoveryInput) => {
      const recovery = resolveReadyGateTerminalRecovery(
        recoveryInput ?? { reason: source },
      );
      const key = `${sessionId}:${source}:${recovery.category}`;
      if (duplicateTerminalSuppressionKeysRef.current.has(key)) return;
      duplicateTerminalSuppressionKeysRef.current.add(key);
      trackReadyGateClientEvent(
        LobbyPostDateEvents.READY_GATE_CLIENT_DUPLICATE_TERMINAL_SUPPRESSED,
        {
          source,
          source_action: source,
          reason: recoveryInput?.reason ?? source,
          error_code: recoveryInput?.errorCode ?? recoveryInput?.code ?? null,
          inactive_reason: recoveryInput?.inactiveReason ?? null,
          terminal: true,
          terminal_category: recovery.category,
        },
      );
      addReadyGateBreadcrumb("duplicate_terminal_recovery_suppressed", {
        source,
        terminalCategory: recovery.category,
      });
    },
    [addReadyGateBreadcrumb, sessionId, trackReadyGateClientEvent],
  );

  const navigateToDate = useCallback(
    (source: string) => {
      if (dateNavigationStartedRef.current) {
        suppressDuplicateNav(source);
        return;
      }
      dateNavigationStartedRef.current = true;
      closedRef.current = true;
      setIsTransitioning(true);
      recordUserAction("ready_gate_handoff_navigating", {
        surface: "ready_gate_overlay",
        session_id: sessionId,
        event_id: eventId,
        source,
      });
      addReadyGateBreadcrumb("date_navigation_started", { source });
      readyGateDebug("success-path navigation to date", { sessionId, source });
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "ready_gate_overlay",
        checkpoint: "navigation_started",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "navigation_started",
          sourceAction: source,
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: "ready_gate_overlay",
        source_action: source,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_BOTH_READY, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: "ready_gate_overlay",
        source_action: source,
      });
      vdbg("lobby_navigate_to_date", {
        trigger: `ready_gate_overlay_${source}`,
        sessionId,
        eventId,
        target: `/date/${sessionId}`,
      });
      onNavigateToDate(sessionId, `ready_gate_overlay_${source}`);
    },
    [
      sessionId,
      eventId,
      onNavigateToDate,
      suppressDuplicateNav,
      addReadyGateBreadcrumb,
    ],
  );

  const navigateToDateForSurveyRecovery = useCallback(
    (source: string) => {
      if (dateNavigationStartedRef.current) {
        suppressDuplicateNav(source);
        return;
      }
      dateNavigationStartedRef.current = true;
      closedRef.current = true;
      setIsTransitioning(true);
      addReadyGateBreadcrumb("pending_survey_navigation_started", { source });
      vdbg("ready_gate_pending_survey_navigate_to_date", {
        trigger: `ready_gate_overlay_${source}`,
        sessionId,
        eventId,
        target: `/date/${sessionId}`,
      });
      onNavigateToDate(sessionId, `ready_gate_overlay_${source}`);
    },
    [
      addReadyGateBreadcrumb,
      eventId,
      onNavigateToDate,
      sessionId,
      suppressDuplicateNav,
    ],
  );

  const preloadVideoDateRoute = useCallback(
    (sourceAction: string) => {
      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "ready_gate_overlay",
        checkpoint: "video_date_route_preload_started",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: "video_date_route_preload_started",
          sourceAction,
          outcome: "success",
        }),
      );
      const preloadPromise = preloadRoute("videoDate");
      void preloadPromise
        ?.then(() => {
          const successContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId,
            sourceSurface: "ready_gate_overlay",
            checkpoint: "video_date_route_preload_success",
          });
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: successContext,
              checkpoint: "video_date_route_preload_success",
              sourceAction,
              outcome: "success",
            }),
          );
          vdbg("video_date_route_preloaded", {
            sessionId,
            eventId,
            sourceAction,
          });
        })
        .catch(() => undefined);
    },
    [eventId, sessionId],
  );

  const markRealtimeDegraded = useCallback(
    (
      reason:
        | "channel_error"
        | "channel_closed"
        | "channel_timed_out"
        | "missed_progress_detection",
    ) => {
      clearOverlayRealtimeRecoveryTimer();
      overlayRealtimeDegradedRef.current = true;
      setRealtimeDegraded(true);
      if (readyGateRealtimeDegradedLoggedRef.current) return;
      readyGateRealtimeDegradedLoggedRef.current = true;
      trackEvent(LobbyPostDateEvents.READY_GATE_REALTIME_DEGRADED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source: "ready_gate_overlay",
        reason,
        elapsed_ms: Math.max(0, Date.now() - readyGateOpenedAtMsRef.current),
      });
    },
    [clearOverlayRealtimeRecoveryTimer, eventId, sessionId],
  );

  const refreshMediaDiagnostics = useCallback(async () => {
    const readyGateKey = activeReadyGateKeyRef.current;
    setMediaDiagnostics((current) => ({
      ...current,
      cameraPermissionStatus:
        current.cameraPermissionStatus === "blocked" ? "blocked" : "checking",
      microphonePermissionStatus:
        current.microphonePermissionStatus === "blocked"
          ? "blocked"
          : "checking",
    }));
    const next = await inspectWebReadyGateMediaDiagnostics();
    if (activeReadyGateKeyRef.current !== readyGateKey) return;
    setMediaDiagnostics((current) => ({
      cameraPermissionStatus: mergeRefreshedDiagnosticStatus(
        next.cameraPermissionStatus,
        current.cameraPermissionStatus,
      ),
      microphonePermissionStatus: mergeRefreshedDiagnosticStatus(
        next.microphonePermissionStatus,
        current.microphonePermissionStatus,
      ),
      cameraDeviceStatus: mergeRefreshedDiagnosticStatus(
        next.cameraDeviceStatus,
        current.cameraDeviceStatus,
      ),
      microphoneDeviceStatus: mergeRefreshedDiagnosticStatus(
        next.microphoneDeviceStatus,
        current.microphoneDeviceStatus,
      ),
    }));
  }, []);

  // Web Ready Gate permission prewarm: writes the existing
  // VideoDatePermissionHandoff (consumed by useVideoCall ~L1372) so the date
  // screen can skip its own getUserMedia roundtrip. Two trigger sources:
  //   * "ready_gate_open"  — silent fast-path; only runs when the Permissions
  //     API reports camera state === "granted", so no prompt is ever shown
  //     outside of a user gesture.
  //   * "ready_tap"        — invoked in the "I'm Ready" click handler so the
  //     prompt (if any) fires inside transient activation.
  // The acquired stream is kept briefly so Daily prewarm can publish the exact
  // same app-acquired track instead of reopening the camera with a different
  // aspect negotiation.
  const runPermissionPrewarm = useCallback(
    async (source: "ready_gate_open" | "ready_tap"): Promise<boolean> => {
      const userId = user?.id;
      if (permissionPrewarmStartedRef.current) {
        if (
          source === "ready_tap" &&
          !permissionPrewarmMediaRef.current &&
          permissionPrewarmCapturePendingRef.current
        ) {
          lastPermissionPrewarmOutcomeRef.current = "transient";
          vdbg("ready_gate_permission_prewarm_pending", {
            sessionId,
            eventId,
            userId,
            source,
          });
        }
        if (source !== "ready_tap" || permissionPrewarmMediaRef.current) {
          if (permissionPrewarmMediaRef.current) {
            lastPermissionPrewarmOutcomeRef.current = "granted";
          }
          return Boolean(permissionPrewarmMediaRef.current);
        }
        permissionPrewarmStartedRef.current = false;
      }
      if (closedRef.current || dateNavigationStartedRef.current) return false;
      if (!userId) return false;
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      )
        return false;
      const readyGateKey = activeReadyGateKey;

      if (
        getVideoDatePermissionHandoff(sessionId, userId) &&
        (source !== "ready_tap" || permissionPrewarmMediaRef.current)
      ) {
        permissionPrewarmStartedRef.current = true;
        lastPermissionPrewarmOutcomeRef.current = "granted";
        return true;
      }

      let sourceAction =
        source === "ready_gate_open"
          ? "permission_prewarm_silent"
          : "permission_prewarm_gesture";

      if (source === "ready_gate_open") {
        // Never open the camera silently (outside a user gesture) unless we have
        // proof it is already granted; otherwise we wait for the "I'm Ready" /
        // "Allow" tap so the prompt fires inside transient activation.
        let cameraGranted = false;
        let microphoneGranted = false;
        let permissionsApiAvailable = false;
        try {
          const permissionsQuery = navigator.permissions?.query;
          if (!permissionsQuery) throw new Error("permissions_api_unavailable");
          const [cameraStatus, microphoneStatus] = await Promise.all([
            permissionsQuery.call(navigator.permissions, {
              name: "camera" as PermissionName,
            }),
            permissionsQuery.call(navigator.permissions, {
              name: "microphone" as PermissionName,
            }),
          ]);
          if (activeReadyGateKeyRef.current !== readyGateKey) return false;
          permissionsApiAvailable = true;
          cameraGranted = cameraStatus.state === "granted";
          microphoneGranted = microphoneStatus.state === "granted";
        } catch {
          if (activeReadyGateKeyRef.current !== readyGateKey) return false;
          if (!permissionPrewarmSkipLoggedRef.current) {
            permissionPrewarmSkipLoggedRef.current = true;
            const skippedContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "web",
              eventId,
              sourceSurface: "ready_gate_overlay",
              checkpoint: "permission_check_skipped",
            });
            trackEvent(
              LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
              buildReadyGateToDateLatencyPayload({
                context: skippedContext,
                checkpoint: "permission_check_skipped",
                sourceAction: "permission_prewarm_silent_no_permissions_api",
                outcome: "no_op",
                reasonCode: "skipped_no_permissions_api",
              }),
            );
          }
        }

        if (!permissionsApiAvailable) {
          // iOS WebKit (Safari + iOS Chrome): the Permissions API does not
          // expose camera/microphone, so fall back to labeled-device evidence as
          // the "already granted" signal. Device labels are only exposed for a
          // media kind the page is already permitted to use.
          let priorGrantEvidence = false;
          try {
            priorGrantEvidence = await hasPriorGrantedVideoDateDeviceLabels();
          } catch {
            priorGrantEvidence = false;
          }
          if (activeReadyGateKeyRef.current !== readyGateKey) return false;
          cameraGranted = priorGrantEvidence;
          microphoneGranted = priorGrantEvidence;
          if (priorGrantEvidence) {
            sourceAction = "permission_prewarm_silent_no_permissions_api";
          }
        }

        if (!cameraGranted || !microphoneGranted) return false;
      }

      permissionPrewarmStartedRef.current = true;
      // Default the outcome to transient until proven granted or denied below.
      lastPermissionPrewarmOutcomeRef.current = "transient";
      const startedAtMs = Date.now();

      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "ready_gate_overlay",
        checkpoint: "permission_check_started",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: "permission_check_started",
          sourceAction,
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_STARTED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "ready_gate_overlay",
        source_action: sourceAction,
      });

      let media: ReadyGatePermissionPrewarmMedia | null = null;
      let capturePromise: Promise<ReadyGatePermissionPrewarmMedia> | null =
        null;
      const captureConsumerToken =
        source === "ready_tap"
          ? permissionPrewarmCaptureConsumerTokenRef.current + 1
          : permissionPrewarmCaptureConsumerTokenRef.current;
      if (source === "ready_tap") {
        permissionPrewarmCaptureConsumerTokenRef.current = captureConsumerToken;
      }
      try {
        // Always await the full silent capture. The user-gesture Ready tap uses
        // a bounded wait below; if the browser resolves late, those tracks are
        // stopped before another tap can start a second capture.
        capturePromise =
          permissionPrewarmCapturePendingRef.current ??
          getVideoDatePermissionPrewarmStream();
        if (!permissionPrewarmCapturePendingRef.current) {
          permissionPrewarmCapturePendingRef.current = capturePromise;
          void capturePromise
            .finally(() => {
              if (
                permissionPrewarmCapturePendingRef.current === capturePromise
              ) {
                permissionPrewarmCapturePendingRef.current = null;
              }
            })
            .catch(() => undefined);
        }
        media =
          source === "ready_tap"
            ? await withReadyGatePermissionPrewarmTimeout(
                capturePromise,
                READY_GATE_PERMISSION_PREWARM_TIMEOUT_MS,
              )
            : await capturePromise;
        if (permissionPrewarmCapturePendingRef.current === capturePromise) {
          permissionPrewarmCapturePendingRef.current = null;
        }

        releasePermissionPrewarmMedia("permission_prewarm_replaced");
        if (activeReadyGateKeyRef.current !== readyGateKey) {
          stopMediaStreamTracks(media.stream);
          return false;
        }

        if (closedRef.current && !dateNavigationStartedRef.current) {
          stopMediaStreamTracks(media.stream);
          return false;
        }
        permissionPrewarmMediaRef.current = media;
        media = null;
        clearPermissionPrewarmMediaReleaseTimer();
        const permissionPrewarmReleaseDelayMs =
          getReadyGatePermissionPrewarmReleaseDelayMs({
            prewarmCompletedAtMs:
              permissionPrewarmMediaRef.current.acquiredAtMs,
            nowMs: Date.now(),
          });
        permissionPrewarmMediaReleaseTimerRef.current = setTimeout(() => {
          releasePermissionPrewarmMedia("permission_prewarm_media_ttl_expired");
        }, permissionPrewarmReleaseDelayMs);

        setVideoDatePermissionHandoff({
          sessionId,
          userId,
          platform: "web",
          captureProfile:
            permissionPrewarmMediaRef.current?.captureProfile ?? null,
          source: "web_ready_gate",
        });
        const mediaHandoff = setWebVideoDateMediaHandoff({
          sessionId,
          userId,
          stream: permissionPrewarmMediaRef.current.stream,
          captureProfile: permissionPrewarmMediaRef.current.captureProfile,
          source: "web_ready_gate_permission_prewarm",
          acquiredAtMs: permissionPrewarmMediaRef.current.acquiredAtMs,
          ttlMs: permissionPrewarmReleaseDelayMs,
        });
        if (mediaHandoff.ok === false) {
          permissionPrewarmMediaHandoffStoredRef.current = false;
          vdbg("ready_gate_media_handoff_store_failed", {
            sessionId,
            eventId,
            userId,
            reason: mediaHandoff.reason,
          });
        } else {
          permissionPrewarmMediaHandoffStoredRef.current = true;
        }
        setMediaDiagnostics({
          cameraPermissionStatus: "ok",
          microphonePermissionStatus: "ok",
          cameraDeviceStatus: "ok",
          microphoneDeviceStatus: "ok",
        });
        const durationMs = Math.max(0, Date.now() - startedAtMs);
        const successContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId,
          sourceSurface: "ready_gate_overlay",
          checkpoint: "permission_check_success",
          permissionHandoffUsed: true,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: successContext,
            checkpoint: "permission_check_success",
            sourceAction,
            outcome: "success",
            durationMs,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "ready_gate_overlay",
          source_action: sourceAction,
          duration_ms: durationMs,
          latency_bucket: bucketVideoDateLatencyMs(durationMs),
        });
        vdbg("ready_gate_permission_prewarm_success", {
          sessionId,
          eventId,
          userId,
          source,
          durationMs,
        });
        lastPermissionPrewarmOutcomeRef.current = "granted";
        return true;
      } catch (error) {
        stopMediaStreamTracks(media?.stream ?? null);
        if (isReadyGatePermissionPrewarmTimeoutError(error)) {
          lastPermissionPrewarmOutcomeRef.current = "transient";
          if (capturePromise) {
            void capturePromise
              .then((lateMedia) => {
                const shouldReleaseLateMedia =
                  permissionPrewarmCaptureConsumerTokenRef.current ===
                  captureConsumerToken;
                if (shouldReleaseLateMedia) {
                  stopMediaStreamTracks(lateMedia.stream);
                }
                if (
                  shouldReleaseLateMedia &&
                  permissionPrewarmCapturePendingRef.current === capturePromise
                ) {
                  permissionPrewarmCapturePendingRef.current = null;
                }
                if (
                  shouldReleaseLateMedia &&
                  activeReadyGateKeyRef.current === readyGateKey &&
                  !permissionPrewarmMediaRef.current
                ) {
                  permissionPrewarmStartedRef.current = false;
                }
              })
              .catch(() => {
                if (
                  permissionPrewarmCapturePendingRef.current === capturePromise
                ) {
                  permissionPrewarmCapturePendingRef.current = null;
                }
                if (
                  activeReadyGateKeyRef.current === readyGateKey &&
                  !permissionPrewarmMediaRef.current
                ) {
                  permissionPrewarmStartedRef.current = false;
                }
              });
          }
          const isActiveReadyGate =
            activeReadyGateKeyRef.current === readyGateKey;
          if (!isActiveReadyGate) return false;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            reason: "ready_gate_permission_prewarm_timeout",
            permission_status: "unknown",
            recovery_action: "request_permission",
            settings_deep_link: "browser_site_settings",
            source_surface: "ready_gate_overlay",
            source_action: sourceAction,
          });
          vdbg("ready_gate_permission_prewarm_timeout", {
            sessionId,
            eventId,
            userId,
            source,
            timeoutMs: READY_GATE_PERMISSION_PREWARM_TIMEOUT_MS,
          });
          return false;
        }
        const permissionResult =
          await classifyMediaPermissionErrorWithBrowserState(
            error,
            "camera_microphone",
          );
        lastPermissionPrewarmOutcomeRef.current =
          permissionResult.status === "denied" ? "denied" : "transient";
        const isActiveReadyGate =
          activeReadyGateKeyRef.current === readyGateKey;
        if (source === "ready_gate_open") {
          if (isActiveReadyGate) {
            permissionPrewarmStartedRef.current = false;
          }
        }
        if (!isActiveReadyGate) return false;
        if (sourceAction === "permission_prewarm_silent_no_permissions_api") {
          // Silent (no-gesture) WebKit capture failed — do NOT overwrite the
          // label-derived resting diagnostics; the user can still trigger the
          // prompt via the "Allow"/"I'm Ready" tap.
          vdbg("ready_gate_permission_prewarm_silent_fallback_failed", {
            sessionId,
            eventId,
            userId,
            source,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
            permissionStatus: permissionResult.status,
            permissionState: permissionResult.permissionState,
            recoveryAction: permissionResult.recoveryAction,
          });
          return false;
        }
        const nextMediaDiagnostics =
          await resolveMediaDiagnosticsAfterPrewarmError(error);
        if (activeReadyGateKeyRef.current !== readyGateKey) return false;
        setMediaDiagnostics(nextMediaDiagnostics);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason: permissionResult.rawErrorName ?? "permission_prewarm_failed",
          error_cause: error instanceof Error ? error.message : String(error),
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          settings_deep_link: "browser_site_settings",
          source_surface: "ready_gate_overlay",
          source_action: sourceAction,
        });
        vdbg("ready_gate_permission_prewarm_failed", {
          sessionId,
          eventId,
          userId,
          source,
          error_cause:
            permissionResult.rawErrorName ?? "permission_prewarm_failed",
          permissionStatus: permissionResult.status,
          permissionState: permissionResult.permissionState,
          recoveryAction: permissionResult.recoveryAction,
          settings_deep_link: "browser_site_settings",
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        return false;
      }
    },
    [
      activeReadyGateKey,
      clearPermissionPrewarmMediaReleaseTimer,
      eventId,
      releasePermissionPrewarmMedia,
      sessionId,
      user?.id,
    ],
  );

  const handleBothReady = useCallback(
    (
      sourceAction:
        | "both_ready_observed"
        | "both_ready_observed_via_rpc_short_circuit" = "both_ready_observed",
    ) => {
      if (closedRef.current && !dateNavigationStartedRef.current) return;
      if (
        prepareEntryHandoffStartedRef.current ||
        dateNavigationStartedRef.current
      ) {
        suppressDuplicateNav(
          prepareEntryHandoffStartedRef.current
            ? "prepare_entry_inflight"
            : "date_navigation_inflight",
        );
        return;
      }
      prepareEntryHandoffStartedRef.current = true;
      recordUserAction("ready_gate_handoff_started", {
        surface: "ready_gate_overlay",
        session_id: sessionId,
        event_id: eventId,
      });
      const runId = prepareEntryRunIdRef.current + 1;
      prepareEntryRunIdRef.current = runId;
      const isCurrentPrepareRun = () =>
        mountedRef.current &&
        prepareEntryRunIdRef.current === runId &&
        !closedRef.current &&
        !dateNavigationStartedRef.current;
      const observedAtMs = Date.now();
      const observedSource =
        sourceAction === "both_ready_observed_via_rpc_short_circuit"
          ? "mark_ready_rpc"
          : "both_ready";
      bothReadyObservedAtMsRef.current = observedAtMs;
      preloadVideoDateRoute(sourceAction);
      setIsTransitioning(true);
      setPrepareEntryStatus("preparing");
      setPrepareEntryFailure(null);
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "ready_gate_overlay",
        checkpoint: sourceAction,
        nowMs: observedAtMs,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: sourceAction,
          sourceAction,
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY_OBSERVED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source: observedSource,
        source_surface: "ready_gate_overlay",
        source_action: sourceAction,
      });
      vdbg("ready_gate_both_ready_observed", {
        sessionId,
        eventId,
        source: observedSource,
        sourceAction,
      });

      const slowWaitTimer = window.setTimeout(() => {
        if (!isCurrentPrepareRun()) return;
        setPrepareEntryStatus("slow");
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_SLOW_WAIT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "ready_gate_overlay",
          source_action: "prepare_entry_slow_wait",
          elapsed_ms: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        });
        vdbg("ready_gate_prepare_entry_slow_wait", {
          sessionId,
          eventId,
          elapsedMs: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        });
      }, VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS);

      void (async () => {
        try {
          for (
            let attempt = 0;
            attempt <= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length;
            attempt += 1
          ) {
            if (!isCurrentPrepareRun()) return;
            setPrepareEntryStatus(attempt === 0 ? "preparing" : "retrying");
            const result = await prepareVideoDateEntry(sessionId, {
              eventId,
              userId: user?.id ?? null,
              source:
                attempt === 0
                  ? "ready_gate_both_ready"
                  : "ready_gate_both_ready_retry",
              force: attempt > 0,
              bothReadyObservedAtMs: observedAtMs,
            });
            if (!isCurrentPrepareRun()) return;
            if (result.ok === true) {
              if (user?.id) {
                updateVideoDateEntryOwnerState({
                  sessionId,
                  userId: user.id,
                  state: "navigating",
                  source: "ready_gate_prepare_success",
                  roomName: result.data.room_name,
                  entryAttemptId: result.data.entry_attempt_id ?? null,
                  videoDateTraceId: result.data.video_date_trace_id ?? null,
                });
              }
              if (user?.id) {
                const prewarmUserId = user.id;
                const prewarmMedia = permissionPrewarmMediaRef.current;
                void startWebVideoDateDailyPrewarm({
                  sessionId,
                  userId: prewarmUserId,
                  eventId,
                  roomName: result.data.room_name,
                  roomUrl: result.data.room_url,
                  captureProfile: prewarmMedia?.captureProfile,
                  appAcquiredMedia: prewarmMedia,
                  source: "ready_gate_prepare_success",
                })
                  .then((prewarm) => {
                    if (
                      prewarm.ok === true &&
                      prewarmMedia &&
                      prewarm.entry.appAcquiredMedia?.stream ===
                        prewarmMedia.stream
                    ) {
                      permissionPrewarmMediaRef.current = null;
                      clearPermissionPrewarmMediaReleaseTimer();
                      clearWebVideoDateMediaHandoff(sessionId, prewarmUserId);
                      permissionPrewarmMediaHandoffStoredRef.current = false;
                    }
                    vdbg("ready_gate_daily_prewarm_prepare_success", {
                      sessionId,
                      eventId,
                      userId: prewarmUserId,
                      roomName: result.data.room_name,
                      ok: prewarm.ok,
                      reason: prewarm.ok === true ? null : prewarm.reason,
                      appAcquiredMedia:
                        prewarm.ok === true
                          ? Boolean(prewarm.entry.appAcquiredMedia)
                          : false,
                    });
                    if (prewarm.ok === true) {
                      // Pre-authenticate only — do NOT join Daily from the lobby. The
                      // real join (which starts the backend entry clock) is owned by
                      // /date (useVideoCall.startCall), so the full warm-up window only
                      // begins once the user is on the stable date route.
                      void preAuthWebVideoDateDailyPrewarm({
                        sessionId,
                        userId: prewarmUserId,
                        eventId,
                        roomName: result.data.room_name,
                        roomUrl: result.data.room_url,
                        token: result.data.token,
                        source: "ready_gate_prepare_success",
                      });
                    }
                  })
                  .catch((error) => {
                    vdbg("ready_gate_daily_prewarm_prepare_success_failed", {
                      sessionId,
                      eventId,
                      userId: prewarmUserId,
                      roomName: result.data.room_name,
                      error:
                        error instanceof Error
                          ? { name: error.name, message: error.message }
                          : String(error),
                    });
                  });
              }
              if (!isCurrentPrepareRun()) return;
              window.clearTimeout(slowWaitTimer);
              setPrepareEntryStatus("idle");
              navigateToDate("both_ready_prepare_success");
              return;
            }

            const recoveryInput: ReadyGateTerminalRecoveryInput = {
              code: result.code,
              errorCode: result.code,
              httpStatus: result.httpStatus ?? null,
              reason: result.message ?? null,
              source: "prepare_entry",
            };
            const inactivePrepareBlocker =
              isReadyGatePrepareEntryNonRetryable(recoveryInput);
            const retryable =
              !inactivePrepareBlocker &&
              shouldRetryVideoDateEntryHandoffFailure(result);
            const exhausted =
              !retryable ||
              attempt >= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length;
            trackReadyGateClientEvent(
              LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_FAILURE,
              {
                source_action: "prepare_entry_failed_no_nav",
                code: result.code,
                error_code: result.code,
                reason: result.message ?? null,
                httpStatus: result.httpStatus ?? null,
                retry_after_ms: result.retryAfterMs ?? null,
                retryable,
                terminal: !retryable,
                attempt: attempt + 1,
                attempt_count: attempt + 1,
                latency_ms: Math.max(0, Date.now() - observedAtMs),
              },
            );
            if (inactivePrepareBlocker) {
              const inactiveKey = `${sessionId}:${result.code}:prepare_entry`;
              if (nonRetryablePrepareFailureRef.current !== inactiveKey) {
                nonRetryablePrepareFailureRef.current = inactiveKey;
                trackReadyGateClientEvent(
                  LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_EVENT_INACTIVE,
                  {
                    source_action: "prepare_entry_event_inactive",
                    code: result.code,
                    error_code: result.code,
                    reason: result.message ?? null,
                    retryable: false,
                    terminal: true,
                    attempt: attempt + 1,
                    latency_ms: Math.max(0, Date.now() - observedAtMs),
                  },
                );
                addReadyGateBreadcrumb("prepare_entry_event_inactive", {
                  code: result.code,
                  attempt: attempt + 1,
                });
              }
            }
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV,
              {
                platform: "web",
                session_id: sessionId,
                event_id: eventId,
                source_surface: "ready_gate_overlay",
                source_action: "prepare_entry_failed_no_nav",
                code: result.code,
                reason_code: result.code,
                httpStatus: result.httpStatus ?? null,
                retry_after_ms: result.retryAfterMs ?? null,
                retryable,
                attempt: attempt + 1,
                attempt_count: attempt + 1,
                exhausted,
              },
            );
            vdbg("ready_gate_prepare_entry_failed_no_nav", {
              sessionId,
              eventId,
              code: result.code,
              httpStatus: result.httpStatus ?? null,
              retryAfterMs: result.retryAfterMs ?? null,
              retryable,
              attempt: attempt + 1,
              exhausted,
            });

            const latestTruth = retryable
              ? await fetchVideoSessionDateEntryTruthCoalesced(sessionId)
              : null;
            if (retryable && isRouteableVideoDateTruth(latestTruth)) {
              window.clearTimeout(slowWaitTimer);
              if (user?.id) {
                updateVideoDateEntryOwnerState({
                  sessionId,
                  userId: user.id,
                  state: "navigating",
                  source: "ready_gate_prepare_routeable_truth_after_failure",
                  roomName: latestTruth?.daily_room_name ?? null,
                });
              }
              trackReadyGateClientEvent(
                LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_FAILURE,
                {
                  source_action: "prepare_entry_routeable_truth_after_failure",
                  code: result.code,
                  error_code: result.code,
                  reason: "canonical_truth_routeable",
                  httpStatus: result.httpStatus ?? null,
                  retryable: false,
                  terminal: false,
                  attempt: attempt + 1,
                  attempt_count: attempt + 1,
                  latency_ms: Math.max(0, Date.now() - observedAtMs),
                  ready_gate_status: latestTruth?.ready_gate_status ?? null,
                  vs_state: latestTruth?.state ?? null,
                  vs_phase: latestTruth?.phase ?? null,
                  daily_room_name: latestTruth?.daily_room_name ?? null,
                },
              );
              addReadyGateBreadcrumb(
                "prepare_entry_routeable_truth_after_failure",
                {
                  attempt: attempt + 1,
                  ready_gate_status: latestTruth?.ready_gate_status ?? null,
                  vs_state: latestTruth?.state ?? null,
                  vs_phase: latestTruth?.phase ?? null,
                },
              );
              setPrepareEntryStatus("idle");
              setPrepareEntryFailure(null);
              navigateToDate("prepare_entry_routeable_truth_after_failure");
              return;
            }
            if (retryable && isTerminalReadyGateTruth(latestTruth)) {
              window.clearTimeout(slowWaitTimer);
              trackReadyGateClientEvent(
                LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_FAILURE,
                {
                  source_action: "prepare_entry_retry_cancelled_terminal",
                  code: "SESSION_ENDED",
                  error_code: "SESSION_ENDED",
                  reason: "canonical_truth_terminal",
                  httpStatus: null,
                  retryable: false,
                  terminal: true,
                  attempt: attempt + 1,
                  attempt_count: attempt + 1,
                  latency_ms: Math.max(0, Date.now() - observedAtMs),
                  ready_gate_status: latestTruth?.ready_gate_status ?? null,
                  vs_state: latestTruth?.state ?? null,
                  vs_phase: latestTruth?.phase ?? null,
                },
              );
              addReadyGateBreadcrumb("prepare_entry_retry_cancelled_terminal", {
                attempt: attempt + 1,
                ready_gate_status: latestTruth?.ready_gate_status ?? null,
                vs_state: latestTruth?.state ?? null,
                vs_phase: latestTruth?.phase ?? null,
              });
              setIsTransitioning(false);
              setPrepareEntryStatus("failed");
              setPrepareEntryFailure({
                code: "SESSION_ENDED",
                message: prepareEntryFailureMessage("SESSION_ENDED"),
                retryable: false,
              });
              prepareEntryHandoffStartedRef.current = true;
              closedRef.current = true;
              toast.info(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, {
                duration: 3600,
              });
              onClose();
              return;
            }

            if (inactivePrepareBlocker) {
              window.clearTimeout(slowWaitTimer);
              setIsTransitioning(false);
              setPrepareEntryStatus("failed");
              setPrepareEntryFailure({
                code: result.code,
                message: prepareEntryFailureMessage(result.code),
                retryable: false,
                httpStatus: result.httpStatus,
              });
              prepareEntryHandoffStartedRef.current = true;
              closedRef.current = true;
              toast.info(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, {
                duration: 3600,
              });
              onClose();
              return;
            }

            if (exhausted) {
              window.clearTimeout(slowWaitTimer);
              if (!dateNavigationStartedRef.current) {
                prepareEntryHandoffStartedRef.current = false;
              }
              // Single prepare-owner gate: only hand off to /date when backend
              // truth proves the session is routeable. A blind navigate after an
              // exhausted prepare caused /date<->lobby bounce churn for sessions
              // that were not actually date-capable.
              const exhaustedTruth =
                await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
              if (isRouteableVideoDateTruth(exhaustedTruth)) {
                if (user?.id) {
                  updateVideoDateEntryOwnerState({
                    sessionId,
                    userId: user.id,
                    state: "navigating",
                    source: "ready_gate_prepare_failed_date_owned",
                    entryAttemptId: result.entryAttemptId ?? null,
                    videoDateTraceId: result.entryAttemptId ?? null,
                    failureCode: result.code,
                    failureMessage: result.message ?? null,
                  });
                }
                setPrepareEntryStatus("idle");
                setPrepareEntryFailure(null);
                prepareEntryHandoffStartedRef.current = true;
                navigateToDate("both_ready_prepare_failed_date_owned");
                return;
              }
              if (!dateNavigationStartedRef.current) {
                prepareEntryHandoffStartedRef.current = false;
              }
              if (isTerminalReadyGateTruth(exhaustedTruth)) {
                setIsTransitioning(false);
                setPrepareEntryStatus("failed");
                setPrepareEntryFailure({
                  code: "SESSION_ENDED",
                  message: prepareEntryFailureMessage("SESSION_ENDED"),
                  retryable: false,
                });
                closedRef.current = true;
                toast.info(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, {
                  duration: 3600,
                });
                onClose();
                return;
              }
              setIsTransitioning(false);
              setPrepareEntryStatus("failed");
              setPrepareEntryFailure({
                code: result.code,
                message: prepareEntryFailureMessage(result.code),
                retryable: true,
                httpStatus: result.httpStatus,
              });
              return;
            }

            setPrepareEntryStatus("retrying");
            await sleep(
              getVideoDateEntryHandoffRetryDelayMs(
                result,
                VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS[attempt],
              ),
            );
          }
        } catch (error) {
          window.clearTimeout(slowWaitTimer);
          if (!dateNavigationStartedRef.current) {
            prepareEntryHandoffStartedRef.current = false;
          }
          Sentry.captureException(error, {
            tags: {
              surface: "ready_gate_overlay",
              action: "prepare_entry_handoff",
            },
            extra: {
              sessionId,
              eventId,
              sourceAction,
            },
          });
          vdbg("ready_gate_prepare_entry_exception_date_owned", {
            sessionId,
            eventId,
            sourceAction,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          if (
            mountedRef.current &&
            !closedRef.current &&
            !dateNavigationStartedRef.current
          ) {
            // Single prepare-owner gate: confirm routeable backend truth before
            // handing off to /date on a client exception instead of blind-navigating.
            const exceptionTruth =
              await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
            if (isRouteableVideoDateTruth(exceptionTruth)) {
              if (user?.id) {
                const failureMessage =
                  error instanceof Error ? error.message : String(error);
                updateVideoDateEntryOwnerState({
                  sessionId,
                  userId: user.id,
                  state: "navigating",
                  source: "ready_gate_prepare_exception_date_owned",
                  failureCode: "PREPARE_ENTRY_CLIENT_EXCEPTION",
                  failureMessage,
                });
              }
              setPrepareEntryStatus("idle");
              setPrepareEntryFailure(null);
              prepareEntryHandoffStartedRef.current = true;
              navigateToDate("both_ready_prepare_exception_date_owned");
            } else if (isTerminalReadyGateTruth(exceptionTruth)) {
              prepareEntryHandoffStartedRef.current = false;
              setIsTransitioning(false);
              setPrepareEntryStatus("failed");
              setPrepareEntryFailure({
                code: "SESSION_ENDED",
                message: prepareEntryFailureMessage("SESSION_ENDED"),
                retryable: false,
              });
              closedRef.current = true;
              toast.info(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, {
                duration: 3600,
              });
              onClose();
            } else {
              prepareEntryHandoffStartedRef.current = false;
              setIsTransitioning(false);
              setPrepareEntryStatus("failed");
              setPrepareEntryFailure({
                code: "PREPARE_ENTRY_CLIENT_EXCEPTION",
                message: prepareEntryFailureMessage(
                  "PREPARE_ENTRY_CLIENT_EXCEPTION",
                ),
                retryable: true,
              });
            }
          }
        } finally {
          window.clearTimeout(slowWaitTimer);
        }
      })();
    },
    [
      addReadyGateBreadcrumb,
      clearPermissionPrewarmMediaReleaseTimer,
      eventId,
      navigateToDate,
      onClose,
      preloadVideoDateRoute,
      sessionId,
      suppressDuplicateNav,
      trackReadyGateClientEvent,
      user?.id,
    ],
  );

  const retryPrepareEntry = useCallback(() => {
    if (dateNavigationStartedRef.current) return;
    prepareEntryHandoffStartedRef.current = false;
    setPrepareEntryFailure(null);
    setPrepareEntryStatus("preparing");
    handleBothReady();
  }, [handleBothReady]);

  const handleForfeited = useCallback(
    (reason: "timeout" | "skip", detail?: ReadyGateTerminalDetail) => {
      const recoveryInput: ReadyGateTerminalRecoveryInput = {
        status:
          detail?.status ?? (reason === "timeout" ? "expired" : "forfeited"),
        reason:
          detail?.reason ??
          (reason === "timeout" ? "ready_gate_expired" : "ready_gate_forfeit"),
        errorCode: detail?.errorCode ?? null,
        code: detail?.code ?? null,
        inactiveReason: detail?.inactiveReason ?? null,
        terminal: detail?.terminal ?? true,
        source: "ready_gate_terminal",
      };
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
      if (closedRef.current || dateNavigationStartedRef.current) {
        suppressDuplicateTerminal("ready_gate_terminal", recoveryInput);
        return;
      }
      closedRef.current = true;
      cancelTerminalReadyGateWork(
        reason === "timeout"
          ? "ready_gate_terminal_expired"
          : "ready_gate_terminal_forfeited",
      );
      terminalActionInFlightRef.current = false;
      setTerminalActionPending(false);
      setTerminalActionError(null);
      readyGateDebug("terminal ready-gate close", {
        sessionId,
        reason,
        terminalCategory: recovery.category,
      });
      if (!terminalOutcomeRef.current) {
        terminalOutcomeRef.current = true;
        trackReadyGateClientEvent(
          LobbyPostDateEvents.READY_GATE_CLIENT_TERMINAL,
          {
            source_action: "ready_gate_terminal",
            ready_gate_status: recoveryInput.status ?? null,
            reason: recoveryInput.reason ?? reason,
            error_code: recoveryInput.errorCode ?? recoveryInput.code ?? null,
            inactive_reason: recoveryInput.inactiveReason ?? null,
            terminal: true,
            terminal_category: recovery.category,
            retryable: recovery.retryable,
            elapsed_ms: Math.max(
              0,
              Date.now() - readyGateOpenedAtMsRef.current,
            ),
          },
        );
        trackEvent(LobbyPostDateEvents.READY_GATE_TIMEOUT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason,
          elapsed_ms: Math.max(0, Date.now() - readyGateOpenedAtMsRef.current),
          age_seconds: Math.max(
            0,
            Math.floor((Date.now() - readyGateOpenedAtMsRef.current) / 1000),
          ),
          realtime_healthy: !realtimeDegraded,
        });
      }
      if (manualExitRequestedRef.current) {
        onManualExitConfirmed?.(sessionId);
      }
      manualExitRequestedRef.current = false;
      toast(recovery.toast, {
        duration: 2500,
      });
      onClose();
    },
    [
      onClose,
      onManualExitConfirmed,
      sessionId,
      eventId,
      realtimeDegraded,
      trackReadyGateClientEvent,
      suppressDuplicateTerminal,
      cancelTerminalReadyGateWork,
    ],
  );

  const closeAsStale = useCallback(
    (source: string, detail?: Record<string, unknown>) => {
      const recoveryInput: ReadyGateTerminalRecoveryInput = {
        status: typeof detail?.status === "string" ? detail.status : null,
        reason: typeof detail?.reason === "string" ? detail.reason : source,
        errorCode:
          typeof detail?.errorCode === "string" ? detail.errorCode : null,
        code: typeof detail?.code === "string" ? detail.code : null,
        inactiveReason:
          typeof detail?.inactiveReason === "string"
            ? detail.inactiveReason
            : null,
        terminal:
          typeof detail?.terminal === "boolean" ? detail.terminal : true,
        source,
      };
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
      if (closedRef.current || dateNavigationStartedRef.current) {
        suppressDuplicateTerminal(source, recoveryInput);
        return;
      }
      closedRef.current = true;
      cancelTerminalReadyGateWork(`ready_gate_stale_${source}`);
      readyGateDebug("stale ready-gate close", {
        sessionId,
        source,
        ...(detail ?? {}),
      });
      trackReadyGateClientEvent(
        LobbyPostDateEvents.READY_GATE_CLIENT_TERMINAL,
        {
          source,
          source_action: source,
          ready_gate_status: recoveryInput.status ?? null,
          reason: recoveryInput.reason ?? source,
          error_code: recoveryInput.errorCode ?? recoveryInput.code ?? null,
          inactive_reason: recoveryInput.inactiveReason ?? null,
          terminal: true,
          terminal_category: recovery.category,
          retryable: recovery.retryable,
        },
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_STALE_CLOSE, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        reason: String(
          (detail as { reason?: unknown } | undefined)?.reason ?? source,
        ),
      });
      const toastKey = `${sessionId}:${recovery.category}:${recoveryInput.reason ?? source}`;
      if (
        !invalidCloseToastRef.current &&
        terminalToastKeyRef.current !== toastKey
      ) {
        invalidCloseToastRef.current = true;
        terminalToastKeyRef.current = toastKey;
        toast.info(recovery.toast || READY_GATE_STALE_OR_ENDED_USER_MESSAGE, {
          duration: 3600,
        });
      }
      onClose();
    },
    [
      onClose,
      sessionId,
      eventId,
      trackReadyGateClientEvent,
      suppressDuplicateTerminal,
      cancelTerminalReadyGateWork,
    ],
  );

  const {
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    isBothReady,
    status: readyGateStatus,
    stateSessionId: readyGateStateSessionId,
    partnerName,
    snoozedByPartner,
    expiresAt,
    serverNowMs,
    clientSyncedAtMs,
    phaseDeadlineAtMs,
    realtimeDegraded: orchestratorRealtimeDegraded,
    sequenceGapUnresolved,
    markReady,
    skip,
    snooze,
    syncSession,
    refetchSession,
    retryBroadcastGapRecovery,
  } = useReadyGate({
    sessionId,
    eventId,
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  useEffect(() => {
    orchestratorRealtimeDegradedRef.current = orchestratorRealtimeDegraded;
    if (orchestratorRealtimeDegraded) {
      setRealtimeDegraded(true);
      return;
    }
    clearRealtimeDegradedWhenHealthy();
  }, [clearRealtimeDegradedWhenHealthy, orchestratorRealtimeDegraded]);

  const runTerminalAction = useCallback(
    async (dismissVariant: ReadyGateTerminalAction) => {
      if (
        dateNavigationStartedRef.current ||
        closedRef.current ||
        terminalActionInFlightRef.current
      )
        return;
      terminalActionInFlightRef.current = true;
      setTerminalActionPending(true);
      setTerminalActionError(null);
      trackEvent(LobbyPostDateEvents.READY_GATE_NOT_NOW_TAP, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        dismiss_variant: dismissVariant,
      });
      manualExitRequestedRef.current = true;
      let transitionFailure: ReturnType<
        typeof resolveReadyGateTransitionFailureCopy
      > | null = null;
      try {
        const result = await skip();
        if (result.ok === false) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: "forfeit",
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason,
            error: result.error,
            status: result.status,
            platform: "web",
          });
          throw new Error(transitionFailure.message);
        }
        if (result.status === "both_ready") {
          manualExitRequestedRef.current = false;
          terminalActionInFlightRef.current = false;
          setTerminalActionPending(false);
          trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            source_surface: "ready_gate_overlay",
            source_action: dismissVariant,
            outcome: "both_ready_race",
            reason: "both_ready",
          });
          return;
        }
        const terminal =
          result.terminal === true ||
          result.isTerminal === true ||
          result.status === "forfeited" ||
          result.status === "expired";
        if (!terminal) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: "forfeit",
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason ?? "ready_gate_forfeit_not_terminal",
            status: result.status,
            platform: "web",
          });
          throw new Error(transitionFailure.message);
        }
        if (!mountedRef.current || dateNavigationStartedRef.current) return;
        trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_SUCCESS, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "ready_gate_overlay",
          source_action: dismissVariant,
          outcome: "success",
          reason: "forfeit",
        });
        handleForfeited(result.status === "expired" ? "timeout" : "skip", {
          status: result.status ?? "forfeited",
          reason: result.reason ?? "ready_gate_forfeit",
          inactiveReason: result.inactiveReason ?? null,
          errorCode: result.errorCode ?? result.code ?? null,
          code: result.code ?? null,
          terminal: true,
        });
      } catch (error) {
        terminalActionInFlightRef.current = false;
        manualExitRequestedRef.current = false;
        if (!mountedRef.current || dateNavigationStartedRef.current) return;
        const fallback =
          transitionFailure ??
          resolveReadyGateTransitionFailureCopy({
            action: "forfeit",
            error: error instanceof Error ? error.message : String(error),
            platform: "web",
          });
        const message = fallback.message;
        setTerminalActionPending(false);
        setTerminalActionError(message);
        readyGateDebug("terminal ready-gate action failed", {
          sessionId,
          dismissVariant,
          message: error instanceof Error ? error.message : String(error),
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "ready_gate_overlay",
          source_action: dismissVariant,
          outcome: "failure",
          reason_code: fallback.reasonCode,
          retryable: fallback.retryable,
          error_name: error instanceof Error ? error.name : "unknown",
          multi_device_conflict: fallback.staleOrConflict,
        });
        trackReadyGateClientEvent(
          LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE,
          {
            action: "forfeit",
            source_action: dismissVariant,
            reason: fallback.reasonCode,
            error_code: fallback.code ?? fallback.reasonCode,
            terminal: false,
            multi_device_conflict: fallback.staleOrConflict,
          },
        );
        toast.error(message, { duration: 3200 });
      }
    },
    [eventId, handleForfeited, sessionId, skip, trackReadyGateClientEvent],
  );

  const reconcileSession = useCallback(
    async (source: string) => {
      if (
        !sessionId ||
        !eventId ||
        !user?.id ||
        dateNavigationStartedRef.current
      )
        return;

      if (
        (source === "initial" || source === "poll") &&
        isBothReady &&
        prepareEntryHandoffStartedRef.current
      ) {
        readyGateDebug(
          "session reconciliation suppressed during prepare handoff",
          {
            sessionId,
            source,
          },
        );
        return;
      }

      if (source === "poll" && readyActionInFlightRef.current) {
        readyGateDebug(
          "poll reconciliation suppressed while mark-ready is in flight",
          {
            sessionId,
            source,
          },
        );
        return;
      }

      const nowMs = Date.now();
      if (
        source === "poll" &&
        reconcileSessionCooldownUntilMsRef.current > nowMs
      ) {
        readyGateDebug(
          "poll reconciliation cooling down after transient sync pressure",
          {
            sessionId,
            retryAtMs: reconcileSessionCooldownUntilMsRef.current,
          },
        );
        return;
      }

      if (reconcileSessionInFlightRef.current) {
        readyGateDebug("session reconciliation coalesced", {
          sessionId,
          source,
        });
        return;
      }

      reconcileSessionInFlightRef.current = true;

      try {
      if (source === "initial" || source === "poll") {
        const syncResult = await syncSession();
        if (dateNavigationStartedRef.current || closedRef.current) return;
        if (syncResult.ok === false) {
          if (isReadyGateTransitionTimeoutSignal(syncResult)) {
            reconcileSessionCooldownUntilMsRef.current =
              Date.now() + READY_GATE_RECONCILE_TIMEOUT_COOLDOWN_MS;
          }
          readyGateDebug("session reconciliation continuing after sync error", {
            sessionId,
            source,
            error: syncResult.error,
          });
          const recoveryInput = {
            reason: syncResult.reason ?? syncResult.error,
            errorCode: syncResult.errorCode ?? null,
            inactiveReason: syncResult.inactiveReason ?? null,
            terminal: syncResult.terminal ?? null,
            source,
          };
          const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
          if (!recovery.retryable || recovery.terminal) {
            closeAsStale(source, recoveryInput);
            return;
          }
        } else {
          reconcileSessionCooldownUntilMsRef.current = 0;
        }
      }

      const [{ data: reg, error: regError }, vs] =
        await Promise.all([
          supabase
            .from("event_registrations")
            .select("queue_status, current_room_id")
            .eq("event_id", eventId)
            .eq("profile_id", user.id)
            .maybeSingle(),
          fetchVideoSessionDateEntryTruthCoalesced(sessionId),
        ]);

      if (dateNavigationStartedRef.current) return;

      if (regError || !vs) {
        readyGateDebug("session reconciliation deferred after query error", {
          sessionId,
          source,
          regError: regError?.message,
          vsError: vs ? null : "video_date_start_snapshot_unavailable",
        });
        return;
      }

      const sameRoom = reg?.current_room_id === sessionId;
      const queueStatus = reg?.queue_status ?? null;
      const readyGateStatus =
        (vs?.ready_gate_status as string | null | undefined) ?? null;
      const isParticipant =
        vs?.participant_1_id === user.id || vs?.participant_2_id === user.id;

      const recovery = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: vs,
        platform: "web",
        surface: "ready_gate",
      });
      const decision = recovery.routeDecision;
      const canAttemptDaily = recovery.canAttemptDaily === true;
      const routedTo =
        recovery.action === "go_date"
          ? "date"
          : recovery.action === "go_survey"
            ? "survey"
            : recovery.action === "go_ready_gate"
              ? "ready"
              : "lobby";

      readyGateDebug("session reconciliation", {
        sessionId,
        source,
        queueStatus,
        sameRoom,
        decision,
        canAttemptDaily,
        routedTo,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        readyGateStatus,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        isParticipant,
        ended: Boolean(vs?.ended_at),
      });
      vdbg("ready_gate_date_route_decision", {
        sessionId,
        eventId,
        source,
        decision,
        canAttemptDaily,
        routed_to: routedTo,
        queueStatus,
        currentRoomId: reg?.current_room_id ?? null,
        readyGateStatus,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        state: vs?.state ?? null,
        phase: vs?.phase ?? null,
      });

      if (!vs) {
        closeAsStale(source, {
          reason: "session_missing",
        });
        return;
      }

      if (!isParticipant) {
        closeAsStale(source, { reason: "not_session_participant" });
        return;
      }

      if (canAttemptDaily || decision === "navigate_date") {
        if (source === "poll") {
          markRealtimeDegraded("missed_progress_detection");
        }
        handleBothReady();
        return;
      }

      if (recovery.action === "go_survey") {
        navigateToDateForSurveyRecovery("pending_survey_recovery");
        return;
      }

      if (decision !== "navigate_ready") {
        closeAsStale(source, {
          reason:
            decision === "ended"
              ? "session_ended"
              : "session_not_ready_gate_eligible",
          queueStatus,
          currentRoomId: reg?.current_room_id ?? null,
        });
        return;
      }

      void refetchSession();
      } finally {
        reconcileSessionInFlightRef.current = false;
      }
    },
    [
      sessionId,
      eventId,
      user?.id,
      isBothReady,
      handleBothReady,
      closeAsStale,
      refetchSession,
      syncSession,
      markRealtimeDegraded,
      navigateToDateForSurveyRecovery,
    ],
  );

  useEffect(() => {
    void reconcileSession("initial");
  }, [reconcileSession]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    if (typeof document === "undefined" || typeof window === "undefined")
      return;

    const retryOnForeground = (source: string) => {
      if (dateNavigationStartedRef.current || closedRef.current) return;
      void retryBroadcastGapRecovery(source);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible")
        retryOnForeground("visibility_resume");
    };
    const handleFocus = () => retryOnForeground("window_focus");
    const handleOnline = () => retryOnForeground("network_online");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [eventId, retryBroadcastGapRecovery, sessionId, user?.id]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    const channel = supabase
      .channel(`ready-gate-reconcile-${sessionId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "event_registrations",
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.event_id !== eventId) return;
          const queueStatus = row.queue_status;
          const currentRoomId = row.current_room_id;
          if (
            currentRoomId === sessionId &&
            ACTIVE_DATE_QUEUE_STATUSES.has(String(queueStatus))
          ) {
            readyGateDebug(
              "same-session active date detected from registration realtime",
              {
                sessionId,
                queueStatus,
              },
            );
            handleBothReady();
            return;
          }
          void reconcileSession("registration_realtime");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const recovery = adviseVideoSessionTruthRecovery({
            sessionId,
            eventId,
            truth: row,
            platform: "web",
            surface: "ready_gate",
          });
          if (recovery.action === "go_date") {
            readyGateDebug(
              "same-session active date detected from video session realtime",
              {
                sessionId,
                state: row.state,
                phase: row.phase,
                readyGateStatus: row.ready_gate_status,
                readyGateExpiresAt: row.ready_gate_expires_at,
              },
            );
            handleBothReady();
            return;
          }
          void reconcileSession("video_session_realtime");
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (overlayRealtimeDegradedRef.current) {
            scheduleOverlayRealtimeRecovery();
          } else {
            clearRealtimeDegradedWhenHealthy();
          }
        } else if (status === "CHANNEL_ERROR") {
          markRealtimeDegraded("channel_error");
        } else if (status === "TIMED_OUT") {
          markRealtimeDegraded("channel_timed_out");
        } else if (status === "CLOSED") {
          markRealtimeDegraded("channel_closed");
        }
      });

    return () => {
      clearOverlayRealtimeRecoveryTimer();
      supabase.removeChannel(channel);
    };
  }, [
    sessionId,
    eventId,
    user?.id,
    handleBothReady,
    reconcileSession,
    markRealtimeDegraded,
    clearOverlayRealtimeRecoveryTimer,
    clearRealtimeDegradedWhenHealthy,
    scheduleOverlayRealtimeRecovery,
  ]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id || dateNavigationStartedRef.current)
      return;
    const pollFallbackActive = realtimeDegraded || sequenceGapUnresolved;
    if (!pollFallbackActive) return;
    const intervalMs = READY_GATE_DEGRADED_SYNC_POLL_MS;
    const intervalId = setInterval(() => {
      if (realtimeDegraded && !realtimeFallbackLoggedRef.current) {
        realtimeFallbackLoggedRef.current = true;
        if (realtimeFallbackCopyTimerRef.current) {
          clearTimeout(realtimeFallbackCopyTimerRef.current);
        }
        realtimeFallbackCopyTimerRef.current = setTimeout(() => {
          realtimeFallbackCopyTimerRef.current = null;
          if (!dateNavigationStartedRef.current && mountedRef.current) {
            setShowRealtimeFallbackCopy(true);
          }
        }, 6_000);
        trackEvent(LobbyPostDateEvents.REALTIME_FALLBACK_TO_POLL, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source: "ready_gate_overlay",
          reason: "realtime_degraded",
        });
      }
      void reconcileSession("poll");
    }, intervalMs);
    return () => {
      clearInterval(intervalId);
      if (realtimeFallbackCopyTimerRef.current) {
        clearTimeout(realtimeFallbackCopyTimerRef.current);
        realtimeFallbackCopyTimerRef.current = null;
      }
    };
  }, [
    sessionId,
    eventId,
    user?.id,
    realtimeDegraded,
    sequenceGapUnresolved,
    reconcileSession,
  ]);

  useEffect(() => {
    if (iAmReady) {
      readyActionInFlightRef.current = false;
      setMarkingReady(false);
    }
  }, [iAmReady]);

  useEffect(() => {
    releasePermissionPrewarmMedia("ready_gate_session_changed");
    closedRef.current = false;
    dateNavigationStartedRef.current = false;
    invalidCloseToastRef.current = false;
    readyGateImpressionRef.current = false;
    openingWaitImpressionRef.current = false;
    terminalOutcomeRef.current = false;
    expirySyncInFlightRef.current = false;
    expirySyncRetryAtMsRef.current = 0;
    realtimeFallbackLoggedRef.current = false;
    readyGateRealtimeDegradedLoggedRef.current = false;
    clearOverlayRealtimeRecoveryTimer();
    overlayRealtimeDegradedRef.current = false;
    orchestratorRealtimeDegradedRef.current = false;
    terminalActionInFlightRef.current = false;
    readyActionInFlightRef.current = false;
    manualExitRequestedRef.current = false;
    duplicateNavSuppressionKeysRef.current = new Set();
    duplicateTerminalSuppressionKeysRef.current = new Set();
    terminalToastKeyRef.current = null;
    nonRetryablePrepareFailureRef.current = null;
    bothReadyObservedAtMsRef.current = null;
    readyGateOpenedAtMsRef.current = Date.now();
    prepareEntryHandoffStartedRef.current = false;
    permissionPrewarmStartedRef.current = false;
    permissionPrewarmCapturePendingRef.current = null;
    permissionPrewarmCaptureConsumerTokenRef.current = 0;
    permissionPrewarmMediaHandoffStoredRef.current = false;
    permissionPrewarmSkipLoggedRef.current = false;
    prepareEntryRunIdRef.current += 1;
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setPrepareEntryStatus("idle");
    setPrepareEntryFailure(null);
    setMediaDiagnostics(READY_GATE_MEDIA_DIAGNOSTICS_CHECKING);
    clearRealtimeFallbackCopy();
    setRealtimeDegraded(false);
    setTerminalActionPending(false);
    setTerminalActionError(null);
    setTimeLeft(GATE_TIMEOUT);
    if (!readyGateImpressionRef.current) {
      readyGateImpressionRef.current = true;
      const latencyContext = startReadyGateToDateLatencyContext({
        platform: "web",
        sessionId,
        eventId,
        sourceSurface: "ready_gate_overlay",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_STARTED,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "ready_gate_impression",
          sourceAction: "impression",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_IMPRESSION, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "ready_gate_overlay",
        source_action: "impression",
      });
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_SHOWN, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "ready_gate_overlay",
        source_action: "impression",
      });
    }
    preloadVideoDateRoute("ready_gate_open");
  }, [
    sessionId,
    eventId,
    preloadVideoDateRoute,
    releasePermissionPrewarmMedia,
    clearRealtimeFallbackCopy,
    clearOverlayRealtimeRecoveryTimer,
  ]);

  // Both-ready liveness guard: if the orchestrator reports both participants
  // ready but the one-shot onBothReady edge was missed (e.g. realtime degraded
  // / "Status sync delayed"), still drive the prepare-entry handoff so the gate
  // cannot silently stall on "Both ready. Connecting you now…". It must run
  // after the session reset effect above so reset cannot invalidate the handoff
  // it starts on first mount/session switch.
  useEffect(() => {
    if (!isBothReady) return;
    if (readyGateStateSessionId !== sessionId) return;
    handleBothReady("both_ready_observed");
  }, [isBothReady, handleBothReady, readyGateStateSessionId, sessionId]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    void refreshMediaDiagnostics();
    void runPermissionPrewarm("ready_gate_open");
  }, [
    eventId,
    refreshMediaDiagnostics,
    runPermissionPrewarm,
    sessionId,
    user?.id,
  ]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      prepareEntryRunIdRef.current += 1;
      if (overlayRealtimeRecoveryTimerRef.current) {
        clearTimeout(overlayRealtimeRecoveryTimerRef.current);
        overlayRealtimeRecoveryTimerRef.current = null;
      }
      if (realtimeFallbackCopyTimerRef.current) {
        clearTimeout(realtimeFallbackCopyTimerRef.current);
        realtimeFallbackCopyTimerRef.current = null;
      }
      const latestContext = latestUnmountCleanupContextRef.current;
      if (!dateNavigationStartedRef.current && latestContext.userId) {
        destroyWebVideoDateDailyPrewarm(
          latestContext.sessionId,
          latestContext.userId,
          "ready_gate_unmount_before_date_navigation",
        );
      }
      const media = permissionPrewarmMediaRef.current;
      if (media) {
        permissionPrewarmMediaRef.current = null;
        if (permissionPrewarmMediaReleaseTimerRef.current) {
          clearTimeout(permissionPrewarmMediaReleaseTimerRef.current);
          permissionPrewarmMediaReleaseTimerRef.current = null;
        }
        const keepMediaHandoffForDate =
          dateNavigationStartedRef.current &&
          Boolean(latestContext.userId) &&
          permissionPrewarmMediaHandoffStoredRef.current;
        if (latestContext.userId && !keepMediaHandoffForDate) {
          clearWebVideoDateMediaHandoff(
            latestContext.sessionId,
            latestContext.userId,
          );
        }
        if (!keepMediaHandoffForDate) {
          permissionPrewarmMediaHandoffStoredRef.current = false;
        }
        if (!keepMediaHandoffForDate) {
          stopMediaStreamTracks(media.stream);
        }
        vdbg("ready_gate_permission_prewarm_media_released", {
          sessionId: latestContext.sessionId,
          eventId: latestContext.eventId,
          captureProfile: media.captureProfile,
          source: media.source,
          reason: keepMediaHandoffForDate
            ? "ready_gate_unmount_handoff_kept_for_date"
            : "ready_gate_unmount",
          ageMs: Math.max(0, Date.now() - media.acquiredAtMs),
        });
      }
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [sessionId]);

  useEffect(() => {
    if (
      isTransitioning ||
      isBothReady ||
      !iAmReady ||
      !partnerReadyKnown ||
      partnerReady ||
      snoozedByPartner
    )
      return;
    if (openingWaitImpressionRef.current) return;
    openingWaitImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.READY_GATE_OPENING_WAIT_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
  }, [
    eventId,
    iAmReady,
    isBothReady,
    isTransitioning,
    partnerReady,
    partnerReadyKnown,
    sessionId,
    snoozedByPartner,
  ]);

  // Fetch partner photo + shared vibes
  useEffect(() => {
    if (!sessionId || !user?.id) {
      setPartnerPhotos(null);
      setPartnerAvatarUrl(null);
      setSharedVibes([]);
      return;
    }

    let cancelled = false;
    setPartnerPhotos(null);
    setPartnerAvatarUrl(null);
    setSharedVibes([]);

    void (async () => {
      const snapshot = await fetchVideoDateStartSnapshot(sessionId);
      if (cancelled || !snapshot.ok || !snapshot.partnerId) return;

      // Partner photo + vibes through the session-aware profile RPC.
      let profile: unknown = null;
      try {
        const { data, error: profileError } = await fetchVideoDatePartnerProfile(
          snapshot.partnerId,
        );
        if (cancelled) return;
        if (profileError) {
          vdbg("ready_gate_partner_profile_display_degraded", {
            sessionId,
            eventId,
            error: profileError.message,
          });
        } else {
          profile = data;
        }
      } catch (error) {
        if (cancelled) return;
        vdbg("ready_gate_partner_profile_display_degraded", {
          sessionId,
          eventId,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      const partnerProfile = profile as {
        avatar_url?: unknown;
        photos?: unknown;
        vibes?: unknown;
      } | null;
      if (partnerProfile) {
        const photos = Array.isArray(partnerProfile.photos)
          ? partnerProfile.photos.filter(
              (photo): photo is string =>
                typeof photo === "string" && photo.trim().length > 0,
            )
          : null;
        const avatarUrl =
          typeof partnerProfile.avatar_url === "string"
            ? partnerProfile.avatar_url.trim()
            : "";
        setPartnerPhotos(photos?.length ? photos : null);
        setPartnerAvatarUrl(avatarUrl || null);
      }

      // Shared vibes
      const { data: myVibes } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label, emoji)")
        .eq("profile_id", user.id);

      if (cancelled) return;

      if (myVibes && Array.isArray(partnerProfile?.vibes)) {
        const myLabels = new Set(
          myVibes
            .map((v) => {
              const raw = v.vibe_tags as
                | { label?: unknown }
                | Array<{ label?: unknown }>
                | null;
              const tag = Array.isArray(raw) ? raw[0] : raw;
              return typeof tag?.label === "string"
                ? tag.label.trim().toLowerCase()
                : null;
            })
            .filter((label): label is string => Boolean(label)),
        );
        const seen = new Set<string>();
        const shared = partnerProfile.vibes.flatMap((label) => {
          if (typeof label !== "string") return [];
          const trimmed = label.trim();
          const key = trimmed.toLowerCase();
          if (!trimmed || !myLabels.has(key) || seen.has(key)) return [];
          seen.add(key);
          return [trimmed];
        });
        setSharedVibes(shared);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, sessionId, user?.id]);

  // Countdown timer (only when user hasn't pressed ready yet)
  useEffect(() => {
    if (
      isTransitioning ||
      iAmReady ||
      markingReady ||
      snoozedByPartner ||
      terminalActionPending
    )
      return;

    const tick = () => {
      const countdown = getReadyGateCountdownFromServerClock({
        expiresAt: phaseDeadlineAtMs ?? expiresAt,
        serverNowMs,
        clientSyncedAtMs,
        fallbackDeadlineMs:
          readyGateOpenedAtMsRef.current + GATE_TIMEOUT * 1000,
        fallbackSeconds: GATE_TIMEOUT,
      });
      const next = countdown.remainingSeconds;
      setTimeLeft(next);
      if (next <= 0) {
        const now = Date.now();
        if (
          expirySyncInFlightRef.current ||
          expirySyncRetryAtMsRef.current > now
        ) {
          return;
        }
        expirySyncInFlightRef.current = true;
        expirySyncRetryAtMsRef.current = now + EXPIRY_SYNC_RETRY_DELAY_MS;
        void syncSession()
          .then((result) => {
            if (result.ok === false) {
              readyGateDebug("countdown expiry sync deferred after RPC error", {
                sessionId,
                error: result.error,
              });
            }
          })
          .finally(() => {
            expirySyncInFlightRef.current = false;
          });
      }
    };

    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [
    isTransitioning,
    iAmReady,
    markingReady,
    snoozedByPartner,
    terminalActionPending,
    expiresAt,
    serverNowMs,
    clientSyncedAtMs,
    phaseDeadlineAtMs,
    syncSession,
    sessionId,
  ]);

  const progress = getReadyGateCountdownProgress(timeLeft, GATE_TIMEOUT);
  const ringSize = 96;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const transitionCopy = prepareEntryTransitionCopy(
    prepareEntryStatus,
    prepareEntryFailure,
  );
  const readyGateReadinessCopy = getReadyGateReadinessStatusCopy({
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    isBothReady,
    markingReady,
    partnerName,
  });
  const showConnectingReadinessCopy =
    readyGateReadinessCopy.key === "both_ready_connecting";
  const showReadyActionControls = !iAmReady && !showConnectingReadinessCopy;
  const diagnosticChecklist = resolveReadyGateDiagnosticChecklist({
    platform: "web",
    partnerName,
    ...mediaDiagnostics,
    // Neutral "waiting" until the prepare-entry handoff actually begins; only
    // "checking" while it is running; "failed" on terminal failure. Avoids
    // claiming a "check in progress" before any provider work has started.
    videoProviderStatus:
      prepareEntryStatus === "failed"
        ? "failed"
        : prepareEntryStatus !== "idle"
          ? "checking"
          : "waiting",
    realtimeSyncStatus:
      realtimeDegraded || sequenceGapUnresolved ? "warning" : "ok",
    partnerReadinessStatus:
      isBothReady || partnerReady ? "ok" : iAmReady ? "warning" : "checking",
  });
  const mediaDiagnosticsAreGreen =
    mediaDiagnostics.cameraPermissionStatus === "ok" &&
    mediaDiagnostics.microphonePermissionStatus === "ok" &&
    mediaDiagnostics.cameraDeviceStatus === "ok" &&
    mediaDiagnostics.microphoneDeviceStatus === "ok";
  const handleDiagnosticAction = (row: ReadyGateDiagnosticCopy) => {
    if (terminalActionPending) return;
    switch (row.actionKind) {
      case "request_permission":
        void runPermissionPrewarm("ready_tap").then(() => {
          void refreshMediaDiagnostics();
        });
        return;
      case "retry":
        if (row.key === "video_provider" && prepareEntryFailure?.retryable) {
          retryPrepareEntry();
          return;
        }
        void refreshMediaDiagnostics();
        return;
      case "check_connection":
        void retryBroadcastGapRecovery("diagnostic_retry");
        void reconcileSession("diagnostic_retry");
        return;
      case "open_settings":
      case "none":
      case "wait":
        return;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ready-gate-title"
      aria-describedby="ready-gate-description"
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto px-4 py-4"
      style={{
        boxSizing: "border-box",
        height: "100dvh",
        minHeight: "100svh",
        paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))",
        paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => {}}
      />

      {/* Transitioning to video */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-10 bg-background flex items-center justify-center"
          >
            <div
              className="px-6 text-center space-y-4"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <motion.div
                animate={
                  prefersReducedMotion ? undefined : { scale: [1, 1.2, 1] }
                }
                transition={
                  prefersReducedMotion
                    ? undefined
                    : { duration: 1.5, repeat: Infinity }
                }
                aria-hidden="true"
              >
                {prepareEntryStatus === "failed" ? (
                  <X className="w-12 h-12 text-destructive mx-auto" />
                ) : (
                  <Sparkles className="w-12 h-12 text-primary mx-auto" />
                )}
              </motion.div>
              <p className="text-lg font-display font-semibold text-foreground break-words">
                {transitionCopy.title}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto break-words">
                {transitionCopy.body}
              </p>
              {prepareEntryStatus === "failed" && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {prepareEntryFailure?.retryable && (
                    <button
                      type="button"
                      onClick={retryPrepareEntry}
                      disabled={terminalActionPending}
                      aria-label="Try video setup again"
                      className="min-h-10 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium"
                    >
                      Try again
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void runTerminalAction("prepare_failed_back");
                    }}
                    disabled={terminalActionPending}
                    aria-label="Leave this Ready Gate and return to the lobby"
                    aria-busy={terminalActionPending}
                    className="min-h-10 px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    {terminalActionPending ? "Leaving..." : "Back to lobby"}
                  </button>
                </div>
              )}
              {terminalActionError && (
                <p className="text-xs text-destructive max-w-xs mx-auto">
                  {terminalActionError}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : { y: 100, scale: 0.95, opacity: 0 }
        }
        animate={
          prefersReducedMotion ? { opacity: 1 } : { y: 0, scale: 1, opacity: 1 }
        }
        exit={
          prefersReducedMotion
            ? { opacity: 0 }
            : { y: 100, scale: 0.95, opacity: 0 }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 300, damping: 28 }
        }
        className="relative z-10 max-h-full min-h-[min(30rem,calc(100dvh-2rem))] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 overscroll-contain sm:min-h-[min(34rem,calc(100dvh-2rem))]"
        style={{
          background:
            "linear-gradient(145deg, hsl(var(--card)), hsl(var(--card) / 0.95))",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="p-6 space-y-5">
          {/* Heading */}
          <div className="text-center space-y-1">
            <h2
              id="ready-gate-title"
              className="text-xl font-display font-bold text-foreground break-words"
            >
              Ready to vibe?
            </h2>
            <p
              id="ready-gate-description"
              className="text-sm text-muted-foreground break-words"
            >
              You matched with {partnerName || "someone"}.
            </p>
          </div>

          {/* Blurred partner photo */}
          <div className="flex justify-center">
            <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-primary/30">
              <div>
                <ProfilePhoto
                  photos={partnerPhotos}
                  avatarUrl={partnerAvatarUrl}
                  name={partnerName || "Match"}
                  size="full"
                  rounded="full"
                  loading="eager"
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="text-white font-display font-semibold text-sm">
                  {partnerName || "Match"}
                </span>
              </div>
            </div>
          </div>

          {/* Shared vibes */}
          {sharedVibes.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {sharedVibes.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Partner ready indicator */}
          <AnimatePresence>
            {partnerReady && !iAmReady && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                role="status"
                aria-live="polite"
                className="flex items-center justify-center gap-2 py-2"
              >
                <Check className="w-4 h-4 text-green-400" aria-hidden="true" />
                <span className="text-sm text-green-400 font-medium">
                  {partnerName} is ready!
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Snoozed by partner */}
          <AnimatePresence>
            {snoozedByPartner && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                role="status"
                aria-live="polite"
                className="flex items-center justify-center gap-2 py-2"
              >
                <Clock
                  className="w-4 h-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted-foreground">
                  {partnerName} needs a moment...
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className="space-y-2 border-t border-white/10 pt-3"
            aria-label="Ready Gate diagnostics"
          >
            {diagnosticChecklist.rows.map((row) => {
              const isError = row.severity === "error";
              const isWarning = row.severity === "warning";
              const accentClass =
                row.severity === "success"
                  ? "text-green-400 bg-green-400/10"
                  : isError
                    ? "text-destructive bg-destructive/10"
                    : isWarning
                      ? "text-amber-300 bg-amber-300/10"
                      : "text-muted-foreground bg-white/5";
              const Icon = row.status === "ok" ? Check : isError ? X : Clock;
              const showAction =
                row.actionLabel &&
                row.actionKind !== "none" &&
                row.actionKind !== "wait";
              return (
                <div
                  key={row.key}
                  className="flex min-h-10 items-center gap-2 text-left"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${accentClass}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">
                      {row.label}
                    </span>
                    {row.status !== "ok" && (
                      <span className="block break-words text-[11px] leading-4 text-muted-foreground">
                        {row.title}
                      </span>
                    )}
                  </span>
                  {showAction && (
                    <button
                      type="button"
                      onClick={() => handleDiagnosticAction(row)}
                      disabled={terminalActionPending}
                      className="min-h-8 shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-foreground disabled:opacity-50"
                    >
                      {row.actionLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action area */}
          {showRealtimeFallbackCopy && !isTransitioning && (
            <p
              className="text-center text-xs text-muted-foreground break-words"
              role="status"
              aria-live="polite"
            >
              Syncing your date status...
            </p>
          )}
          {terminalActionError && !isTransitioning && (
            <p
              className="text-center text-xs text-destructive break-words"
              role="alert"
            >
              {terminalActionError}
            </p>
          )}

          {/* Action area */}
          {showReadyActionControls ? (
            <div className="space-y-3">
              {/* Ready button with countdown ring */}
              <div className="flex justify-center">
                <motion.button
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
                  onClick={() => {
                    if (
                      readyActionInFlightRef.current ||
                      markingReady ||
                      requestingSnooze ||
                      terminalActionPending
                    ) {
                      return;
                    }
                    readyActionInFlightRef.current = true;
                    recordUserAction("ready_gate_ready_clicked", {
                      surface: "ready_gate_overlay",
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    const latencyContext =
                      recordReadyGateToDateLatencyCheckpoint({
                        sessionId,
                        platform: "web",
                        eventId,
                        sourceSurface: "ready_gate_overlay",
                        checkpoint: "ready_tap",
                      });
                    trackEvent(
                      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                      buildReadyGateToDateLatencyPayload({
                        context: latencyContext,
                        checkpoint: "ready_tap",
                        sourceAction: "ready_tap",
                        outcome: "success",
                      }),
                    );
                    trackEvent(LobbyPostDateEvents.READY_GATE_READY_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: "ready_gate_overlay",
                      source_action: "ready_tap",
                    });
                    trackEvent(
                      LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY,
                      {
                        platform: "web",
                        session_id: sessionId,
                        event_id: eventId,
                        source_surface: "ready_gate_overlay",
                        source_action: "ready_tap",
                      },
                    );
                    setMarkingReady(true);
                    void (async () => {
                      let transitionFailure: ReturnType<
                        typeof resolveReadyGateTransitionFailureCopy
                      > | null = null;
                      try {
                        setTerminalActionError(null);
                        const permissionReady =
                          await runPermissionPrewarm("ready_tap");
                        if (!permissionReady) {
                          const permissionBlocked =
                            lastPermissionPrewarmOutcomeRef.current === "denied";
                          trackEvent(
                            LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED,
                            {
                              platform: "web",
                              session_id: sessionId,
                              event_id: eventId,
                              reason: mediaDiagnosticsAreGreen
                                ? "ready_tap_permission_prewarm_failed_diagnostics_ok"
                                : permissionBlocked
                                  ? "ready_tap_permission_denied"
                                  : "ready_tap_permission_not_ready",
                              permission_status: permissionBlocked
                                ? "denied"
                                : "unknown",
                              recovery_action: permissionBlocked
                                ? "open_settings"
                                : "request_permission",
                              settings_deep_link: "browser_site_settings",
                              source_surface: "ready_gate_overlay",
                              source_action: "ready_tap",
                            },
                          );
                          setTerminalActionError(
                            permissionBlocked
                              ? "Camera and microphone are blocked. Allow access in your browser settings, then tap I'm Ready again."
                              : "Allow camera and microphone access to join this date.",
                          );
                          return;
                        }
                        const result = await markReady();
                        if (result.ok === false) {
                          if (isReadyGateTransitionTimeoutSignal(result)) {
                            const syncResult = await syncSession();
                            if (
                              syncResult.ok === true &&
                              isReadyGateReadyProgressStatus(syncResult.status)
                            ) {
                              setTerminalActionError(null);
                              if (syncResult.status === "both_ready") {
                                handleBothReady(
                                  "both_ready_observed_via_rpc_short_circuit",
                                );
                              }
                              return;
                            }
                          }
                          transitionFailure =
                            resolveReadyGateTransitionFailureCopy({
                              action: "mark_ready",
                              code: result.code,
                              errorCode: result.errorCode,
                              reason: result.reason,
                              error: result.error,
                              status: result.status,
                              retryable: result.retryable,
                              platform: "web",
                            });
                          throw new Error(transitionFailure.message);
                        }
                        if (result.status === "both_ready") {
                          handleBothReady(
                            "both_ready_observed_via_rpc_short_circuit",
                          );
                        } else if (result.isTerminal === true) {
                          return;
                        }
                      } catch (error) {
                        const fallback =
                          transitionFailure ??
                          resolveReadyGateTransitionFailureCopy({
                            action: "mark_ready",
                            error:
                              error instanceof Error
                                ? error.message
                                : String(error),
                            platform: "web",
                          });
                        const message = fallback.message;
                        setTerminalActionError(message);
                        readyGateDebug("mark ready failed", {
                          sessionId,
                          message:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        });
                        trackReadyGateClientEvent(
                          LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE,
                          {
                            action: "mark_ready",
                            source_action: "ready_tap",
                            reason: fallback.reasonCode,
                            error_code: fallback.code ?? fallback.reasonCode,
                            terminal: false,
                            multi_device_conflict: fallback.staleOrConflict,
                          },
                        );
                        toast.error(message, { duration: 3200 });
                      } finally {
                        readyActionInFlightRef.current = false;
                        setMarkingReady(false);
                      }
                    })();
                  }}
                  disabled={
                    markingReady || requestingSnooze || terminalActionPending
                  }
                  aria-label={
                    markingReady
                      ? "Marking you ready"
                      : `Mark ready, ${timeLeft} seconds left`
                  }
                  aria-busy={markingReady}
                  className="relative"
                >
                  <svg
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    className="absolute inset-0 -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth={strokeWidth}
                      opacity={0.3}
                    />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      className="transition-all duration-1000 linear"
                    />
                  </svg>
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
                    <span className="text-[13px] font-display font-bold text-primary-foreground text-center leading-tight px-1">
                      {markingReady ? "Marking..." : "I'm Ready"}
                    </span>
                  </div>
                </motion.button>
              </div>
              <p className="sr-only">
                {timeLeft > 0
                  ? `${timeLeft} seconds left in this Ready Gate.`
                  : "Ready Gate countdown ended."}
              </p>
              <p className="text-center text-xs text-muted-foreground break-words">
                Snooze gives you up to 2 extra minutes. Step away exits this
                match attempt.
              </p>

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      requestingSnooze ||
                      markingReady ||
                      terminalActionPending
                    )
                      return;
                    trackEvent(LobbyPostDateEvents.READY_GATE_SNOOZE_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    setRequestingSnooze(true);
                    void (async () => {
                      let transitionFailure: ReturnType<
                        typeof resolveReadyGateTransitionFailureCopy
                      > | null = null;
                      try {
                        setTerminalActionError(null);
                        const result = await snooze();
                        if (result.ok === false) {
                          transitionFailure =
                            resolveReadyGateTransitionFailureCopy({
                              action: "snooze",
                              code: result.code,
                              errorCode: result.errorCode,
                              reason: result.reason,
                              error: result.error,
                              status: result.status,
                              platform: "web",
                            });
                          throw new Error(transitionFailure.message);
                        }
                      } catch (error) {
                        const fallback =
                          transitionFailure ??
                          resolveReadyGateTransitionFailureCopy({
                            action: "snooze",
                            error:
                              error instanceof Error
                                ? error.message
                                : String(error),
                            platform: "web",
                          });
                        const message = fallback.message;
                        setTerminalActionError(message);
                        readyGateDebug("snooze failed", {
                          sessionId,
                          message:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        });
                        trackReadyGateClientEvent(
                          LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE,
                          {
                            action: "snooze",
                            source_action: "snooze_tap",
                            reason: fallback.reasonCode,
                            error_code: fallback.code ?? fallback.reasonCode,
                            terminal: false,
                            multi_device_conflict: fallback.staleOrConflict,
                          },
                        );
                        toast.error(message, { duration: 3200 });
                      } finally {
                        setRequestingSnooze(false);
                      }
                    })();
                  }}
                  disabled={
                    requestingSnooze || markingReady || terminalActionPending
                  }
                  aria-label="Snooze this Ready Gate for two minutes"
                  aria-busy={requestingSnooze}
                  className="min-h-10 rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {requestingSnooze ? "Snoozing..." : "Snooze — give me 2 min"}
                </button>
                <span className="text-muted-foreground/70">·</span>
                <button
                  type="button"
                  onClick={() => {
                    void runTerminalAction("skip_this_one");
                  }}
                  disabled={
                    markingReady || requestingSnooze || terminalActionPending
                  }
                  aria-label="Step away from this Ready Gate"
                  aria-busy={terminalActionPending}
                  className="min-h-10 rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {terminalActionPending ? "Leaving..." : "Step away"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <motion.div
                animate={
                  prefersReducedMotion ? undefined : { scale: [1, 1.05, 1] }
                }
                transition={
                  prefersReducedMotion
                    ? undefined
                    : { duration: 2, repeat: Infinity }
                }
                role="status"
                aria-live="polite"
                className="inline-flex min-h-10 items-center gap-2 px-5 py-2.5 rounded-full bg-primary/10 border border-primary/20"
              >
                {showConnectingReadinessCopy ? (
                  <Sparkles
                    className="w-4 h-4 text-primary"
                    aria-hidden="true"
                  />
                ) : readyGateReadinessCopy.key === "syncing" ? (
                  <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
                ) : (
                  <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                )}
                <span className="text-sm font-medium text-foreground break-words">
                  {readyGateReadinessCopy.text}
                </span>
              </motion.div>
              <button
                type="button"
                onClick={() => {
                  void runTerminalAction("cancel_go_back");
                }}
                disabled={
                  requestingSnooze || markingReady || terminalActionPending
                }
                aria-label="Step away while waiting for your match"
                aria-busy={terminalActionPending}
                className="block min-h-10 mx-auto rounded-full px-5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {terminalActionPending ? "Leaving..." : "Step away"}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ReadyGateOverlay;
