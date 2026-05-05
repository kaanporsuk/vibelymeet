import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, Clock, Sparkles, X } from "lucide-react";
import { useReadyGate } from "@/hooks/useReadyGate";
import { vdbg } from "@/lib/vdbg";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  prepareVideoDateEntry,
  prepareVideoDateSoloEntry,
  videoDateDailySoloPrejoinEnabled,
} from "@/lib/videoDatePrepareEntry";
import { preloadRoute } from "@/lib/routePreload";
import { videoDateWebMediaStreamConstraints } from "@/lib/dailyCallObjectConfig";
import {
  destroyWebVideoDateDailyPrewarm,
  joinWebVideoDateDailyPrewarm,
  preAuthWebVideoDateDailyPrewarm,
  startWebVideoDateDailyPrewarm,
} from "@/lib/videoDateDailyPrewarm";
import {
  ensureVideoDateRoomWarmup,
  videoDateRoomWarmupAfterReadyEnabled,
} from "@/lib/videoDateRoomWarmup";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { toast } from "sonner";
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from "@shared/matching/videoSessionFlow";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { emitWebVideoDateClientStuckState } from "@/lib/videoDateClientStuckObservability";
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
import { isVideoDateCameraConstraintError } from "@clientShared/matching/videoDateMediaContract";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from "@clientShared/matching/activeSession";
import {
  getReadyGateCountdownProgress,
  getReadyGateRemainingSeconds,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from "@clientShared/matching/readyGateCountdown";
import {
  VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS,
  VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
  getVideoDateEntryHandoffStatusCopy,
  shouldRetryVideoDateEntryHandoffFailure,
  type VideoDateEntryHandoffStatus,
} from "@clientShared/matching/videoDateEntryRetryPolicy";
import {
  isReadyGatePrepareEntryNonRetryable,
  resolveReadyGateTerminalRecovery,
  type ReadyGateTerminalRecoveryInput,
} from "@clientShared/matching/readyGateTerminalRecovery";

interface ReadyGateOverlayProps {
  sessionId: string;
  eventId: string;
  onClose: () => void;
  onNavigateToDate: (sessionId: string, source: string) => void;
  onManualExitConfirmed?: (sessionId: string) => void;
}

const GATE_TIMEOUT = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const WEB_READY_GATE_SILENT_PERMISSION_FALLBACK_WAIT_MS = 100;
const ACTIVE_DATE_QUEUE_STATUSES = new Set(["in_handshake", "in_date"]);
const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;

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

function hasLabeledDevice(devices: MediaDeviceInfo[], kind: MediaDeviceKind): boolean {
  return devices.some((device) => device.kind === kind && device.label.trim().length > 0);
}

async function hasPriorGrantedVideoDateDeviceLabels(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return hasLabeledDevice(devices, "videoinput") && hasLabeledDevice(devices, "audioinput");
}

async function getVideoDatePermissionPrewarmStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(
      videoDateWebMediaStreamConstraints("ideal"),
    );
  } catch (idealError) {
    if (!isVideoDateCameraConstraintError(idealError)) throw idealError;
    return await navigator.mediaDevices.getUserMedia(
      videoDateWebMediaStreamConstraints("fallback"),
    );
  }
}

function waitForMediaStreamWithTimeout(
  streamPromise: Promise<MediaStream>,
  timeoutMs: number,
): Promise<MediaStream | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      resolve(null);
    }, timeoutMs);

    void streamPromise.then(
      (stream) => {
        if (settled) {
          stopMediaStreamTracks(stream);
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(stream);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
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
  const recovery = resolveReadyGateTerminalRecovery({
    code,
    errorCode: code,
    source: "prepare_entry",
  });
  if (!recovery.retryable) return recovery.body;

  switch (code) {
    case "UNAUTHORIZED":
      return "Please sign in again, then try once more.";
    case "ACCESS_DENIED":
      return "You do not have access to this date.";
    case "BLOCKED_PAIR":
      return "This call is no longer available.";
    case "SESSION_ENDED":
      return "This date has already ended.";
    case "EVENT_NOT_ACTIVE":
      return "This Ready Gate is no longer available.";
    case "DAILY_AUTH_FAILED":
    case "DAILY_CREDENTIALS_INVALID":
      return "Video provider authentication failed. Please try again later.";
    case "DAILY_REQUEST_REJECTED":
      return "The video room could not be prepared. Please try again later.";
    case "DAILY_RATE_LIMIT":
    case "DAILY_PROVIDER_UNAVAILABLE":
    case "DAILY_PROVIDER_ERROR":
      return "The video service is still setting up. Please try again in a moment.";
    default:
      return "We could not prepare the video room. Please try again.";
  }
}

function prepareEntryTransitionCopy(status: PrepareEntryStatus, failure: PrepareEntryFailureState) {
  return getVideoDateEntryHandoffStatusCopy(status, failure?.message);
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
  const [prepareEntryStatus, setPrepareEntryStatus] = useState<PrepareEntryStatus>("idle");
  const [prepareEntryFailure, setPrepareEntryFailure] = useState<PrepareEntryFailureState>(null);
  const [showRealtimeFallbackCopy, setShowRealtimeFallbackCopy] = useState(false);
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(null);
  const closedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const invalidCloseToastRef = useRef(false);
  const readyGateImpressionRef = useRef(false);
  const openingWaitImpressionRef = useRef(false);
  const terminalOutcomeRef = useRef(false);
  const expirySyncInFlightRef = useRef(false);
  const expirySyncRetryAtMsRef = useRef(0);
  const fallbackGateDeadlineMsRef = useRef(Date.now() + GATE_TIMEOUT * 1000);
  const activeReadyGateKey = `${sessionId}:${eventId}`;
  const activeReadyGateKeyRef = useRef(activeReadyGateKey);
  const bothReadyObservedAtMsRef = useRef<number | null>(null);
  const readyGateOpenedAtMsRef = useRef(Date.now());
  const prepareEntryHandoffStartedRef = useRef(false);
  const permissionPrewarmStartedRef = useRef(false);
  const permissionPrewarmSkipLoggedRef = useRef(false);
  const roomWarmupStartedRef = useRef(false);
  const prepareEntryRunIdRef = useRef(0);
  const realtimeFallbackLoggedRef = useRef(false);
  const readyGateRealtimeDegradedLoggedRef = useRef(false);
  const realtimeFallbackCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalActionInFlightRef = useRef(false);
  const manualExitRequestedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const duplicateNavSuppressionKeysRef = useRef<Set<string>>(new Set());
  const duplicateTerminalSuppressionKeysRef = useRef<Set<string>>(new Set());
  const terminalToastKeyRef = useRef<string | null>(null);
  const nonRetryablePrepareFailureRef = useRef<string | null>(null);
  const latestUnmountCleanupContextRef = useRef({
    sessionId,
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

  useLayoutEffect(() => {
    activeReadyGateKeyRef.current = activeReadyGateKey;
  }, [activeReadyGateKey]);

  useLayoutEffect(() => {
    latestUnmountCleanupContextRef.current = {
      sessionId,
      userId: user?.id ?? null,
    };
  }, [sessionId, user?.id]);

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
      trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_DUPLICATE_NAV_SUPPRESSED, {
        source,
        source_action: source,
        ready_gate_status: "both_ready",
        reason: "navigation_already_started",
        terminal: false,
      });
      addReadyGateBreadcrumb("duplicate_date_navigation_suppressed", { source });
    },
    [addReadyGateBreadcrumb, sessionId, trackReadyGateClientEvent],
  );

  const suppressDuplicateTerminal = useCallback(
    (source: string, recoveryInput?: ReadyGateTerminalRecoveryInput) => {
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput ?? { reason: source });
      const key = `${sessionId}:${source}:${recovery.category}`;
      if (duplicateTerminalSuppressionKeysRef.current.has(key)) return;
      duplicateTerminalSuppressionKeysRef.current.add(key);
      trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_DUPLICATE_TERMINAL_SUPPRESSED, {
        source,
        source_action: source,
        reason: recoveryInput?.reason ?? source,
        error_code: recoveryInput?.errorCode ?? recoveryInput?.code ?? null,
        inactive_reason: recoveryInput?.inactiveReason ?? null,
        terminal: true,
        terminal_category: recovery.category,
      });
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
    [sessionId, eventId, onNavigateToDate, suppressDuplicateNav, addReadyGateBreadcrumb]
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
          vdbg("video_date_route_preloaded", { sessionId, eventId, sourceAction });
        })
        .catch(() => undefined);
    },
    [eventId, sessionId],
  );

  const markRealtimeDegraded = useCallback(
    (reason: "channel_error" | "channel_closed" | "channel_timed_out" | "missed_progress_detection") => {
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
    [eventId, sessionId],
  );

  // Web Ready Gate permission prewarm: writes the existing
  // VideoDatePermissionHandoff (consumed by useVideoCall ~L1372) so the date
  // screen can skip its own getUserMedia roundtrip. Two trigger sources:
  //   * "ready_gate_open"  — silent fast-path; only runs when the Permissions
  //     API reports camera state === "granted", so no prompt is ever shown
  //     outside of a user gesture.
  //   * "ready_tap"        — invoked in the "I'm Ready" click handler so the
  //     prompt (if any) fires inside transient activation.
  // Tracks are stopped immediately after acquisition; Phase 2's Daily prewarm
  // will own the stream lifetime.
  const runPermissionPrewarm = useCallback(
    async (source: "ready_gate_open" | "ready_tap"): Promise<void> => {
      if (permissionPrewarmStartedRef.current) return;
      if (closedRef.current || dateNavigationStartedRef.current) return;
      const userId = user?.id;
      if (!userId) return;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      const readyGateKey = activeReadyGateKey;

      if (getVideoDatePermissionHandoff(sessionId, userId)) {
        permissionPrewarmStartedRef.current = true;
        return;
      }

      let sourceAction =
        source === "ready_gate_open" ? "permission_prewarm_silent" : "permission_prewarm_gesture";
      let silentFallbackWaitMs: number | null = null;

      if (source === "ready_gate_open") {
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
          if (activeReadyGateKeyRef.current !== readyGateKey) return;
          if (cameraStatus.state !== "granted" || microphoneStatus.state !== "granted") return;
        } catch {
          if (activeReadyGateKeyRef.current !== readyGateKey) return;
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

          let priorGrantEvidence = false;
          try {
            priorGrantEvidence = await hasPriorGrantedVideoDateDeviceLabels();
          } catch {
            priorGrantEvidence = false;
          }
          if (activeReadyGateKeyRef.current !== readyGateKey) return;
          if (!priorGrantEvidence) return;
          sourceAction = "permission_prewarm_silent_no_permissions_api";
          silentFallbackWaitMs = WEB_READY_GATE_SILENT_PERMISSION_FALLBACK_WAIT_MS;
        }
      }

      permissionPrewarmStartedRef.current = true;
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

      let stream: MediaStream | null = null;
      try {
        const streamPromise = getVideoDatePermissionPrewarmStream();
        stream = silentFallbackWaitMs == null
          ? await streamPromise
          : await waitForMediaStreamWithTimeout(streamPromise, silentFallbackWaitMs);
        if (!stream) {
          permissionPrewarmStartedRef.current = false;
          vdbg("ready_gate_permission_prewarm_silent_fallback_timed_out", {
            sessionId,
            eventId,
            userId,
            source,
            waitMs: silentFallbackWaitMs,
          });
          return;
        }

        stopMediaStreamTracks(stream);
        stream = null;
        if (activeReadyGateKeyRef.current !== readyGateKey) {
          return;
        }

        if (closedRef.current && !dateNavigationStartedRef.current) {
          return;
        }

        setVideoDatePermissionHandoff({
          sessionId,
          userId,
          platform: "web",
          source: "web_ready_gate",
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
      } catch (error) {
        stopMediaStreamTracks(stream);
        const isActiveReadyGate = activeReadyGateKeyRef.current === readyGateKey;
        if (source === "ready_gate_open") {
          if (isActiveReadyGate) {
            permissionPrewarmStartedRef.current = false;
          }
        }
        if (!isActiveReadyGate) return;
        if (sourceAction === "permission_prewarm_silent_no_permissions_api") {
          vdbg("ready_gate_permission_prewarm_silent_fallback_failed", {
            sessionId,
            eventId,
            userId,
            source,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          return;
        }
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason: error instanceof Error ? error.name : "permission_prewarm_failed",
          source_surface: "ready_gate_overlay",
          source_action: sourceAction,
        });
        vdbg("ready_gate_permission_prewarm_failed", {
          sessionId,
          eventId,
          userId,
          source,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    },
    [activeReadyGateKey, eventId, sessionId, user?.id],
  );

  const canStartDailyPrewarmAfterWarmup = useCallback(
    async (userId: string): Promise<boolean> => {
      if (getVideoDatePermissionHandoff(sessionId, userId)) return true;
      if (typeof navigator === "undefined" || !navigator.permissions?.query) return false;
      try {
        const [camera, microphone] = await Promise.all([
          navigator.permissions.query({ name: "camera" as PermissionName }),
          navigator.permissions.query({ name: "microphone" as PermissionName }),
        ]);
        return camera.state === "granted" && microphone.state === "granted";
      } catch {
        return false;
      }
    },
    [sessionId],
  );

  const startRoomWarmupAfterReady = useCallback(
    (source: string, readyGateStatus?: string | null) => {
      if (!videoDateRoomWarmupAfterReadyEnabled()) return;
      if (roomWarmupStartedRef.current || dateNavigationStartedRef.current || closedRef.current) return;
      if (readyGateStatus && !["ready_a", "ready_b", "both_ready"].includes(readyGateStatus)) return;
      if (readyGateStatus === "both_ready" && prepareEntryHandoffStartedRef.current) return;
      const userId = user?.id;
      if (!userId) return;

      roomWarmupStartedRef.current = true;
      const readyGateKey = activeReadyGateKey;
      void (async () => {
        const result = await ensureVideoDateRoomWarmup(sessionId, {
          eventId,
          userId,
          source,
        });
        if (activeReadyGateKeyRef.current !== readyGateKey) return;
        if (dateNavigationStartedRef.current || closedRef.current) return;
        if (result.ok !== true) {
          vdbg("ready_gate_room_warmup_after_ready_skipped", {
            sessionId,
            eventId,
            userId,
            source,
            code: result.code,
            retryable: result.retryable,
          });
          return;
        }

        const canPrewarmDaily = await canStartDailyPrewarmAfterWarmup(userId);
        if (activeReadyGateKeyRef.current !== readyGateKey) return;
        if (!canPrewarmDaily || dateNavigationStartedRef.current || closedRef.current) {
          vdbg("ready_gate_daily_prewarm_after_room_warmup_skipped", {
            sessionId,
            eventId,
            userId,
            source,
            reason: canPrewarmDaily ? "closed_or_navigating" : "permission_not_proven",
          });
          return;
        }

        const prewarm = startWebVideoDateDailyPrewarm({
          sessionId,
          userId,
          eventId,
          roomName: result.data.room_name,
          roomUrl: result.data.room_url,
          source: "ready_gate_room_warmup_success",
        });
        vdbg("ready_gate_daily_prewarm_after_room_warmup", {
          sessionId,
          eventId,
          userId,
          source,
          roomName: result.data.room_name,
          ok: prewarm.ok,
          reason: prewarm.ok === true ? null : prewarm.reason,
        });
        if (
          prewarm.ok === true &&
          videoDateDailySoloPrejoinEnabled() &&
          readyGateStatus !== "both_ready" &&
          !dateNavigationStartedRef.current &&
          !closedRef.current
        ) {
          const soloEntry = await prepareVideoDateSoloEntry(sessionId, {
            eventId,
            userId,
            source: "ready_gate_solo_prejoin",
          });
          if (activeReadyGateKeyRef.current !== readyGateKey) return;
          if (soloEntry.ok !== true || dateNavigationStartedRef.current || closedRef.current) {
            vdbg("ready_gate_solo_prejoin_skipped", {
              sessionId,
              eventId,
              userId,
              source,
              ok: soloEntry.ok,
              code: soloEntry.ok === true ? null : soloEntry.code,
            });
            return;
          }
          await joinWebVideoDateDailyPrewarm({
            sessionId,
            userId,
            eventId,
            roomUrl: soloEntry.data.room_url,
            token: soloEntry.data.token,
            source: "ready_gate_solo_prejoin",
            joinSource: "solo_prejoin",
          });
        }
      })();
    },
    [activeReadyGateKey, canStartDailyPrewarmAfterWarmup, eventId, sessionId, user?.id],
  );

  const handleBothReady = useCallback((
    sourceAction: "both_ready_observed" | "both_ready_observed_via_rpc_short_circuit" = "both_ready_observed",
  ) => {
    if (closedRef.current && !dateNavigationStartedRef.current) return;
    if (prepareEntryHandoffStartedRef.current || dateNavigationStartedRef.current) {
      suppressDuplicateNav(prepareEntryHandoffStartedRef.current ? "prepare_entry_inflight" : "date_navigation_inflight");
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
    const observedSource = sourceAction === "both_ready_observed_via_rpc_short_circuit"
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
      void emitWebVideoDateClientStuckState({
        sessionId,
        eventName: "ready_gate_handoff_slow",
        latencyMs: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        payload: {
          source_surface: "ready_gate_overlay",
          source_action: "prepare_entry_slow_wait",
          elapsed_ms: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        },
      });
    }, VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS);

    void (async () => {
      try {
        for (let attempt = 0; attempt <= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length; attempt += 1) {
          if (!isCurrentPrepareRun()) return;
          setPrepareEntryStatus(attempt === 0 ? "preparing" : "retrying");
          const result = await prepareVideoDateEntry(sessionId, {
            eventId,
            userId: user?.id ?? null,
            source: attempt === 0 ? "ready_gate_both_ready" : "ready_gate_both_ready_retry",
            force: attempt > 0,
            bothReadyObservedAtMs: observedAtMs,
          });
          if (!isCurrentPrepareRun()) return;
          if (result.ok === true) {
            if (user?.id) {
              await preAuthWebVideoDateDailyPrewarm({
                sessionId,
                userId: user.id,
                eventId,
                roomUrl: result.data.room_url,
                token: result.data.token,
                source: "ready_gate_prepare_success",
              });
              await joinWebVideoDateDailyPrewarm({
                sessionId,
                userId: user.id,
                eventId,
                roomUrl: result.data.room_url,
                token: result.data.token,
                source: "ready_gate_prepare_success",
                joinSource: "both_ready",
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
            reason: result.message ?? null,
            source: "prepare_entry",
          };
          const inactivePrepareBlocker = isReadyGatePrepareEntryNonRetryable(recoveryInput);
          const retryable = !inactivePrepareBlocker && shouldRetryVideoDateEntryHandoffFailure(result);
          const exhausted = !retryable || attempt >= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length;
          trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_FAILURE, {
            source_action: "prepare_entry_failed_no_nav",
            code: result.code,
            error_code: result.code,
            reason: result.message ?? null,
            httpStatus: result.httpStatus ?? null,
            retryable,
            terminal: !retryable,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
            latency_ms: Math.max(0, Date.now() - observedAtMs),
          });
          if (inactivePrepareBlocker) {
            const inactiveKey = `${sessionId}:${result.code}:prepare_entry`;
            if (nonRetryablePrepareFailureRef.current !== inactiveKey) {
              nonRetryablePrepareFailureRef.current = inactiveKey;
              trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_PREPARE_ENTRY_EVENT_INACTIVE, {
                source_action: "prepare_entry_event_inactive",
                code: result.code,
                error_code: result.code,
                reason: result.message ?? null,
                retryable: false,
                terminal: true,
                attempt: attempt + 1,
                latency_ms: Math.max(0, Date.now() - observedAtMs),
              });
              addReadyGateBreadcrumb("prepare_entry_event_inactive", {
                code: result.code,
                attempt: attempt + 1,
              });
            }
          }
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            source_surface: "ready_gate_overlay",
            source_action: "prepare_entry_failed_no_nav",
            code: result.code,
            reason_code: result.code,
            httpStatus: result.httpStatus ?? null,
            retryable,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
            exhausted,
          });
          vdbg("ready_gate_prepare_entry_failed_no_nav", {
            sessionId,
            eventId,
            code: result.code,
            httpStatus: result.httpStatus ?? null,
            retryable,
            attempt: attempt + 1,
            exhausted,
          });

          if (exhausted) {
            window.clearTimeout(slowWaitTimer);
            void emitWebVideoDateClientStuckState({
              sessionId,
              eventName: "prepare_date_entry_failed",
              payload: {
                source_surface: "ready_gate_overlay",
                source_action: "prepare_entry_failed_no_nav",
                reason_code: result.code,
                code: result.code,
                http_status: result.httpStatus ?? undefined,
                retryable,
                attempt: attempt + 1,
                attempt_count: attempt + 1,
                exhausted,
                entry_attempt_id: result.entryAttemptId ?? undefined,
                video_date_trace_id: result.entryAttemptId ?? undefined,
              },
            });
            setPrepareEntryStatus("failed");
            setPrepareEntryFailure({
              code: result.code,
              message: prepareEntryFailureMessage(result.code),
              retryable,
              httpStatus: result.httpStatus,
            });
            return;
          }

          setPrepareEntryStatus("retrying");
          await sleep(VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS[attempt]);
        }
      } finally {
        window.clearTimeout(slowWaitTimer);
      }
    })();
  }, [eventId, navigateToDate, preloadVideoDateRoute, sessionId, suppressDuplicateNav, trackReadyGateClientEvent, addReadyGateBreadcrumb, user?.id]);

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
        status: detail?.status ?? (reason === "timeout" ? "expired" : "forfeited"),
        reason: detail?.reason ?? (reason === "timeout" ? "ready_gate_expired" : "ready_gate_forfeit"),
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
      terminalActionInFlightRef.current = false;
      setTerminalActionPending(false);
      setTerminalActionError(null);
      readyGateDebug("terminal ready-gate close", { sessionId, reason, terminalCategory: recovery.category });
      if (!terminalOutcomeRef.current) {
        terminalOutcomeRef.current = true;
        trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TERMINAL, {
          source_action: "ready_gate_terminal",
          ready_gate_status: recoveryInput.status ?? null,
          reason: recoveryInput.reason ?? reason,
          error_code: recoveryInput.errorCode ?? recoveryInput.code ?? null,
          inactive_reason: recoveryInput.inactiveReason ?? null,
          terminal: true,
          terminal_category: recovery.category,
          retryable: recovery.retryable,
          elapsed_ms: Math.max(0, Date.now() - readyGateOpenedAtMsRef.current),
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_TIMEOUT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason,
          elapsed_ms: Math.max(0, Date.now() - readyGateOpenedAtMsRef.current),
          age_seconds: Math.max(0, Math.floor((Date.now() - readyGateOpenedAtMsRef.current) / 1000)),
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
    ]
  );

  const closeAsStale = useCallback(
    (source: string, detail?: Record<string, unknown>) => {
      const recoveryInput: ReadyGateTerminalRecoveryInput = {
        status: typeof detail?.status === "string" ? detail.status : null,
        reason: typeof detail?.reason === "string" ? detail.reason : source,
        errorCode: typeof detail?.errorCode === "string" ? detail.errorCode : null,
        code: typeof detail?.code === "string" ? detail.code : null,
        inactiveReason: typeof detail?.inactiveReason === "string" ? detail.inactiveReason : null,
        terminal: typeof detail?.terminal === "boolean" ? detail.terminal : true,
        source,
      };
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
      if (closedRef.current || dateNavigationStartedRef.current) {
        suppressDuplicateTerminal(source, recoveryInput);
        return;
      }
      closedRef.current = true;
      readyGateDebug("stale ready-gate close", { sessionId, source, ...(detail ?? {}) });
      trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TERMINAL, {
        source,
        source_action: source,
        ready_gate_status: recoveryInput.status ?? null,
        reason: recoveryInput.reason ?? source,
        error_code: recoveryInput.errorCode ?? recoveryInput.code ?? null,
        inactive_reason: recoveryInput.inactiveReason ?? null,
        terminal: true,
        terminal_category: recovery.category,
        retryable: recovery.retryable,
      });
      trackEvent(LobbyPostDateEvents.READY_GATE_STALE_CLOSE, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        reason: String((detail as { reason?: unknown } | undefined)?.reason ?? source),
      });
      const toastKey = `${sessionId}:${recovery.category}:${recoveryInput.reason ?? source}`;
      if (!invalidCloseToastRef.current && terminalToastKeyRef.current !== toastKey) {
        invalidCloseToastRef.current = true;
        terminalToastKeyRef.current = toastKey;
        toast.info(recovery.toast || READY_GATE_STALE_OR_ENDED_USER_MESSAGE, { duration: 3600 });
      }
      onClose();
    },
    [onClose, sessionId, eventId, trackReadyGateClientEvent, suppressDuplicateTerminal]
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    expiresAt,
    markReady,
    skip,
    snooze,
    syncSession,
    refetchSession,
  } = useReadyGate({
    sessionId,
    eventId,
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  const runTerminalAction = useCallback(
    async (dismissVariant: ReadyGateTerminalAction) => {
      if (dateNavigationStartedRef.current || closedRef.current || terminalActionInFlightRef.current) return;
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
      try {
        const result = await skip();
        if (!result.ok) {
          throw new Error("ready_gate_forfeit_failed");
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
          throw new Error("ready_gate_forfeit_not_terminal");
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
        const message = "We couldn't step away. Check your connection and try again.";
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
          reason_code: "ready_gate_forfeit_failed",
          retryable: true,
          error_name: error instanceof Error ? error.name : "unknown",
        });
        trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE, {
          action: "forfeit",
          source_action: dismissVariant,
          reason: "ready_gate_forfeit_failed",
          error_code: "ready_gate_forfeit_failed",
          terminal: false,
        });
        toast.error(message, { duration: 3200 });
      }
    },
    [eventId, handleForfeited, sessionId, skip, trackReadyGateClientEvent],
  );

  const reconcileSession = useCallback(
    async (source: string) => {
      if (!sessionId || !eventId || !user?.id || dateNavigationStartedRef.current) return;

      if (source === "initial" || source === "poll") {
        const syncResult = await syncSession();
        if (dateNavigationStartedRef.current || closedRef.current) return;
        if (syncResult.ok === false) {
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
        }
      }

      const [{ data: reg, error: regError }, { data: vs, error: vsError }] = await Promise.all([
        supabase
          .from("event_registrations")
          .select("queue_status, current_room_id")
          .eq("event_id", eventId)
          .eq("profile_id", user.id)
          .maybeSingle(),
        supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id, ended_at, state, phase, ready_gate_status, ready_gate_expires_at, handshake_started_at, daily_room_name, daily_room_url")
          .eq("id", sessionId)
          .maybeSingle(),
      ]);

      if (dateNavigationStartedRef.current) return;

      if (regError || vsError) {
        readyGateDebug("session reconciliation deferred after query error", {
          sessionId,
          source,
          regError: regError?.message,
          vsError: vsError?.message,
        });
        return;
      }

      const sameRoom = reg?.current_room_id === sessionId;
      const queueStatus = reg?.queue_status ?? null;
      const readyGateStatus = (vs?.ready_gate_status as string | null | undefined) ?? null;
      const isParticipant = vs?.participant_1_id === user.id || vs?.participant_2_id === user.id;
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const routedTo =
        canAttemptDaily || decision === "navigate_date"
          ? "date"
          : decision === "navigate_ready"
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

      if (decision !== "navigate_ready") {
        closeAsStale(source, {
          reason: decision === "ended" ? "session_ended" : "session_not_ready_gate_eligible",
          queueStatus,
          currentRoomId: reg?.current_room_id ?? null,
        });
        return;
      }

      void refetchSession();
    },
    [sessionId, eventId, user?.id, handleBothReady, closeAsStale, refetchSession, syncSession, markRealtimeDegraded]
  );

  useEffect(() => {
    void reconcileSession("initial");
  }, [reconcileSession]);

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
          if (currentRoomId === sessionId && ACTIVE_DATE_QUEUE_STATUSES.has(String(queueStatus))) {
            readyGateDebug("same-session active date detected from registration realtime", {
              sessionId,
              queueStatus,
            });
            handleBothReady();
            return;
          }
          void reconcileSession("registration_realtime");
        }
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
          if (
            canAttemptDailyRoomFromVideoSessionTruth(row) ||
            decideVideoSessionRouteFromTruth(row) === "navigate_date"
          ) {
            readyGateDebug("same-session active date detected from video session realtime", {
              sessionId,
              state: row.state,
              phase: row.phase,
              readyGateStatus: row.ready_gate_status,
              readyGateExpiresAt: row.ready_gate_expires_at,
            });
            handleBothReady();
            return;
          }
          void reconcileSession("video_session_realtime");
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          markRealtimeDegraded("channel_error");
        } else if (status === "TIMED_OUT") {
          markRealtimeDegraded("channel_timed_out");
        } else if (status === "CLOSED") {
          markRealtimeDegraded("channel_closed");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, eventId, user?.id, handleBothReady, reconcileSession, markRealtimeDegraded]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id || dateNavigationStartedRef.current) return;
    const intervalMs = realtimeDegraded ? 1_000 : 2_000;
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
  }, [sessionId, eventId, user?.id, realtimeDegraded, reconcileSession]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
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
    terminalActionInFlightRef.current = false;
    manualExitRequestedRef.current = false;
    duplicateNavSuppressionKeysRef.current = new Set();
    duplicateTerminalSuppressionKeysRef.current = new Set();
    terminalToastKeyRef.current = null;
    nonRetryablePrepareFailureRef.current = null;
    bothReadyObservedAtMsRef.current = null;
    readyGateOpenedAtMsRef.current = Date.now();
    prepareEntryHandoffStartedRef.current = false;
    permissionPrewarmStartedRef.current = false;
    permissionPrewarmSkipLoggedRef.current = false;
    roomWarmupStartedRef.current = false;
    prepareEntryRunIdRef.current += 1;
    fallbackGateDeadlineMsRef.current = Date.now() + GATE_TIMEOUT * 1000;
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setPrepareEntryStatus("idle");
    setPrepareEntryFailure(null);
    setShowRealtimeFallbackCopy(false);
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
  }, [sessionId, eventId, preloadVideoDateRoute]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    void runPermissionPrewarm("ready_gate_open");
  }, [eventId, runPermissionPrewarm, sessionId, user?.id]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      prepareEntryRunIdRef.current += 1;
      const latestContext = latestUnmountCleanupContextRef.current;
      if (!dateNavigationStartedRef.current && latestContext.userId) {
        destroyWebVideoDateDailyPrewarm(
          latestContext.sessionId,
          latestContext.userId,
          "ready_gate_unmount_before_date_navigation",
        );
      }
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [sessionId]);

  useEffect(() => {
    if (isTransitioning || !iAmReady || partnerReady || snoozedByPartner) return;
    if (openingWaitImpressionRef.current) return;
    openingWaitImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.READY_GATE_OPENING_WAIT_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
  }, [eventId, iAmReady, isTransitioning, partnerReady, sessionId, snoozedByPartner]);

  // Fetch partner photo + shared vibes
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    (async () => {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!session) return;

      const partnerId =
        session.participant_1_id === user.id
          ? session.participant_2_id
          : session.participant_1_id;

      // Partner photo + vibes through the session-aware profile RPC.
      const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: partnerId,
      });

      const partnerProfile = profile as { avatar_url?: string | null; photos?: string[] | null; vibes?: string[] | null } | null;
      if (partnerProfile) {
        setPartnerPhotos(partnerProfile.photos || null);
        setPartnerAvatarUrl(partnerProfile.avatar_url || null);
      }

      // Shared vibes
      const { data: myVibes } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label, emoji)")
        .eq("profile_id", user.id);

      if (myVibes && partnerProfile?.vibes) {
        const myLabels = new Set(
          myVibes
            .map((v) => {
              const raw = v.vibe_tags as { label: string } | { label: string }[] | null;
              const tag = Array.isArray(raw) ? raw[0] : raw;
              return tag?.label;
            })
            .filter(Boolean)
        );
        const shared = partnerProfile.vibes.filter((label) => myLabels.has(label));
        setSharedVibes(shared);
      }
    })();
  }, [sessionId, user?.id]);

  // Countdown timer (only when user hasn't pressed ready yet)
  useEffect(() => {
    if (isTransitioning || iAmReady || snoozedByPartner || terminalActionPending) return;

    const tick = () => {
      const next = getReadyGateRemainingSeconds({
        expiresAt,
        fallbackDeadlineMs: fallbackGateDeadlineMsRef.current,
      });
      setTimeLeft(next);
      if (next <= 0) {
        const now = Date.now();
        if (expirySyncInFlightRef.current || expirySyncRetryAtMsRef.current > now) {
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
  }, [isTransitioning, iAmReady, snoozedByPartner, terminalActionPending, expiresAt, syncSession, sessionId]);

  const progress = getReadyGateCountdownProgress(timeLeft, GATE_TIMEOUT);
  const ringSize = 96;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const transitionCopy = prepareEntryTransitionCopy(prepareEntryStatus, prepareEntryFailure);

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
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => {}} />

      {/* Transitioning to video */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-10 bg-background flex items-center justify-center"
          >
            <div className="text-center space-y-4" role="status" aria-live="polite" aria-atomic="true">
              <motion.div
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.2, 1] }}
                transition={prefersReducedMotion ? undefined : { duration: 1.5, repeat: Infinity }}
                aria-hidden="true"
              >
                {prepareEntryStatus === "failed" ? (
                  <X className="w-12 h-12 text-destructive mx-auto" />
                ) : (
                  <Sparkles className="w-12 h-12 text-primary mx-auto" />
                )}
              </motion.div>
              <p className="text-lg font-display font-semibold text-foreground">
                {transitionCopy.title}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">{transitionCopy.body}</p>
              {prepareEntryStatus === "failed" && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {prepareEntryFailure?.retryable && (
                    <button
                      type="button"
                      onClick={retryPrepareEntry}
                      disabled={terminalActionPending}
                      aria-label="Try video setup again"
                      className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium"
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
                    className="px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    {terminalActionPending ? "Leaving..." : "Back to lobby"}
                  </button>
                </div>
              )}
              {terminalActionError && (
                <p className="text-xs text-destructive max-w-xs mx-auto">{terminalActionError}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={prefersReducedMotion ? { opacity: 0 } : { y: 100, scale: 0.95, opacity: 0 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { y: 0, scale: 1, opacity: 1 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { y: 100, scale: 0.95, opacity: 0 }}
        transition={prefersReducedMotion ? { duration: 0.12 } : { type: "spring", stiffness: 300, damping: 28 }}
        className="relative z-10 max-h-full w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 overscroll-contain"
        style={{
          background:
            "linear-gradient(145deg, hsl(var(--card)), hsl(var(--card) / 0.95))",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="p-6 space-y-5">
          {/* Heading */}
          <div className="text-center space-y-1">
            <h2 id="ready-gate-title" className="text-xl font-display font-bold text-foreground">
              Ready to vibe?
            </h2>
            <p id="ready-gate-description" className="text-sm text-muted-foreground">
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
                <Clock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">
                  {partnerName} needs a moment...
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action area */}
          {showRealtimeFallbackCopy && !isTransitioning && (
            <p className="text-center text-xs text-muted-foreground" role="status" aria-live="polite">
              Syncing your date status...
            </p>
          )}
          {terminalActionError && !isTransitioning && (
            <p className="text-center text-xs text-destructive" role="alert">
              {terminalActionError}
            </p>
          )}

          {/* Action area */}
          {!iAmReady ? (
            <div className="space-y-3">
              {/* Ready button with countdown ring */}
              <div className="flex justify-center">
                <motion.button
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
                  onClick={() => {
                    if (markingReady || requestingSnooze || terminalActionPending) return;
                    // Fire the gesture-bound permission prewarm BEFORE any
                    // await so the browser sees a live user activation. Runs
                    // in parallel with markReady() — handoff lands well before
                    // the date screen mounts in the typical case.
                    void runPermissionPrewarm("ready_tap");
                    recordUserAction("ready_gate_ready_clicked", {
                      surface: "ready_gate_overlay",
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
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
                    trackEvent(LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: "ready_gate_overlay",
                      source_action: "ready_tap",
                    });
                    setMarkingReady(true);
                    void (async () => {
                      try {
                        setTerminalActionError(null);
                        const result = await markReady();
                        if (!result.ok) {
                          throw new Error("ready_gate_mark_ready_failed");
                        }
                        startRoomWarmupAfterReady("ready_tap_mark_ready_success", result.status ?? null);
                      } catch (error) {
                        const message = "We couldn't mark you ready. Check your connection and try again.";
                        setTerminalActionError(message);
                        readyGateDebug("mark ready failed", {
                          sessionId,
                          message: error instanceof Error ? error.message : String(error),
                        });
                        trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE, {
                          action: "mark_ready",
                          source_action: "ready_tap",
                          reason: "ready_gate_mark_ready_failed",
                          error_code: "ready_gate_mark_ready_failed",
                          terminal: false,
                        });
                        toast.error(message, { duration: 3200 });
                      } finally {
                        setMarkingReady(false);
                      }
                    })();
                  }}
                  disabled={markingReady || requestingSnooze || terminalActionPending}
                  aria-label={markingReady ? "Marking you ready" : `Mark ready, ${timeLeft} seconds left`}
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
                    <span className="text-sm font-display font-bold text-primary-foreground text-center leading-tight px-1">
                      {markingReady ? "Marking ready..." : "I'm Ready"}
                    </span>
                  </div>
                </motion.button>
              </div>
              <p className="sr-only">
                {timeLeft > 0 ? `${timeLeft} seconds left in this Ready Gate.` : "Ready Gate countdown ended."}
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
              </p>

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (requestingSnooze || markingReady || terminalActionPending) return;
                    trackEvent(LobbyPostDateEvents.READY_GATE_SNOOZE_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    setRequestingSnooze(true);
                    void (async () => {
                      try {
                        setTerminalActionError(null);
                        const result = await snooze();
                        if (!result.ok) {
                          throw new Error("ready_gate_snooze_failed");
                        }
                      } catch (error) {
                        const message = "We couldn't snooze this match. Check your connection and try again.";
                        setTerminalActionError(message);
                        readyGateDebug("snooze failed", {
                          sessionId,
                          message: error instanceof Error ? error.message : String(error),
                        });
                        trackReadyGateClientEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE, {
                          action: "snooze",
                          source_action: "snooze_tap",
                          reason: "ready_gate_snooze_failed",
                          error_code: "ready_gate_snooze_failed",
                          terminal: false,
                        });
                        toast.error(message, { duration: 3200 });
                      } finally {
                        setRequestingSnooze(false);
                      }
                    })();
                  }}
                  disabled={requestingSnooze || markingReady || terminalActionPending}
                  aria-label="Snooze this Ready Gate for two minutes"
                  aria-busy={requestingSnooze}
                  className="rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {requestingSnooze ? "Snoozing..." : "Snooze — give me 2 min"}
                </button>
                <span className="text-muted-foreground/70">·</span>
                <button
                  type="button"
                  onClick={() => {
                    void runTerminalAction("skip_this_one");
                  }}
                  disabled={markingReady || requestingSnooze || terminalActionPending}
                  aria-label="Step away from this Ready Gate"
                  aria-busy={terminalActionPending}
                  className="rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {terminalActionPending ? "Leaving..." : "Step away"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <motion.div
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.05, 1] }}
                transition={prefersReducedMotion ? undefined : { duration: 2, repeat: Infinity }}
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary/10 border border-primary/20"
              >
                <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">
                  You're ready. Waiting for {partnerName}...
                </span>
              </motion.div>
              <button
                type="button"
                onClick={() => {
                  void runTerminalAction("cancel_go_back");
                }}
                disabled={requestingSnooze || markingReady || terminalActionPending}
                aria-label="Step away while waiting for your match"
                aria-busy={terminalActionPending}
                className="block mx-auto rounded-full px-5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
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
