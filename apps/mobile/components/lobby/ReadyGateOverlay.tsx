/**
 * In-lobby ready gate: server-backed `ready_gate_transition` + realtime, aligned with web ReadyGateOverlay.
 * No visual redesign — behavior and state machine parity only.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  AppState,
  Linking,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { router, type Href } from 'expo-router';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { ReadyGateDiagnosticChecklist } from '@/components/lobby/ReadyGateDiagnosticChecklist';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useReadyGate, type ReadyGateTerminalDetail } from '@/lib/readyGateApi';
import {
  defaultNativeReadyGateMediaDiagnostics,
  defaultNativeReadyGatePermissionDiagnostics,
  inspectNativeReadyGateMediaDevices,
  type NativeReadyGatePermissionDiagnosticState,
} from '@/lib/readyGateNativeMediaDiagnostics';
import { fetchVideoSessionDateEntryTruthCoalesced } from '@/lib/videoDateApi';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { supabase } from '@/lib/supabase';
import { vdbg } from '@/lib/vdbg';
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from '@shared/matching/videoSessionFlow';
import { trackEvent } from '@/lib/analytics';
import { emitNativeVideoDateClientStuckState } from '@/lib/videoDateClientStuckObservability';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import {
  destroyNativeVideoDateDailyPrewarm,
  preAuthNativeVideoDateDailyPrewarm,
  startNativeVideoDateDailyPrewarm,
} from '@/lib/videoDateDailyPrewarm';
import {
  ensureVideoDateRoomWarmup,
  videoDateRoomWarmupAfterReadyEnabled,
} from '@/lib/videoDateRoomWarmup';
import {
  getReadyGateCountdownProgress,
  getReadyGateCountdownFromServerClock,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from '@clientShared/matching/readyGateCountdown';
import {
  VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS,
  VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
  getVideoDateEntryHandoffStatusCopy,
  shouldRetryVideoDateEntryHandoffFailure,
  type VideoDateEntryHandoffStatus,
} from '@clientShared/matching/videoDateEntryRetryPolicy';
import {
  isReadyGatePrepareEntryNonRetryable,
  type ReadyGateTerminalRecoveryInput,
} from '@clientShared/matching/readyGateTerminalRecovery';
import {
  adviseVideoSessionTruthRecovery,
  resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery,
} from '@clientShared/matching/videoDateRecoveryAdvisor';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import { EventLobbyObservabilityEvents } from '@clientShared/observability/eventLobbyObservability';
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
  startReadyGateToDateLatencyContext,
} from '@clientShared/observability/videoDateOperatorMetrics';
import {
  getVideoDatePermissionHandoff,
  setVideoDatePermissionHandoff,
} from '@clientShared/matching/videoDatePermissionHandoff';
import { getReadyGateReadinessStatusCopy } from '@clientShared/matching/readyGateReadiness';
import {
  resolveReadyGateDiagnosticChecklist,
  resolveReadyGatePrepareEntryFailureCopy,
  type ReadyGateDiagnosticCopy,
} from '@clientShared/matching/readyGateDiagnosticCopy';

const RING_SIZE = 88;
const STROKE = 4;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const GATE_TIMEOUT_SEC = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const READY_GATE_TRUTH_RECONCILE_MS = 10_000;
const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;

type PrepareEntryStatus = VideoDateEntryHandoffStatus;
type PrepareEntryFailure = {
  code: string;
  retryable: boolean;
  httpStatus?: number;
};
type VideoSessionDateEntryTruth = Awaited<ReturnType<typeof fetchVideoSessionDateEntryTruthCoalesced>>;

const NativeReadyGateEvents = {
  TRANSITION_FAILURE: 'native_ready_gate_transition_failure',
  TERMINAL: 'native_ready_gate_terminal',
  PREPARE_ENTRY_FAILURE: 'native_ready_gate_prepare_entry_failure',
  PREPARE_ENTRY_EVENT_INACTIVE: 'native_ready_gate_prepare_entry_event_inactive',
  DUPLICATE_NAV_SUPPRESSED: 'native_ready_gate_duplicate_nav_suppressed',
  DUPLICATE_TERMINAL_SUPPRESSED: 'native_ready_gate_duplicate_terminal_suppressed',
} as const;

function prepareEntryFailureMessage(code: string): string {
  return resolveReadyGatePrepareEntryFailureCopy({ code, platform: 'native' }).message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalReadyGateTruth(vs: VideoSessionDateEntryTruth): boolean {
  const status = vs?.ready_gate_status ?? null;
  return Boolean(
    vs?.ended_at ||
      vs?.state === 'ended' ||
      vs?.phase === 'ended' ||
      status === 'expired' ||
      status === 'forfeited' ||
      status === 'cancelled' ||
      status === 'skipped'
  );
}

export type ReadyGateOverlayProps = {
  sessionId: string;
  eventId: string;
  userId: string;
  partnerImageUri?: string | null;
  onNavigateToDate: (sessionId: string) => void;
  onClose: () => void;
  onManualExitConfirmed?: (sessionId: string) => void;
  /** Sonner-equivalent feedback on the lobby after close (forfeit / stale) — avoids blocking modal alerts. */
  onLobbyUserMessage?: (message: string, variant?: 'info' | 'success') => void;
};

export function ReadyGateOverlay({
  sessionId,
  eventId,
  userId,
  partnerImageUri,
  onNavigateToDate,
  onClose,
  onManualExitConfirmed,
  onLobbyUserMessage,
}: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const closedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const invalidSessionNotifiedRef = useRef(false);
  const rgImpressionRef = useRef(false);
  const permissionBlockedRef = useRef(false);
  const openingPartnerWaitRef = useRef(false);
  const openingPermissionWaitRef = useRef(false);
  const terminalTimeoutRef = useRef(false);
  const expirySyncInFlightRef = useRef(false);
  const expirySyncRetryAtMsRef = useRef(0);
  const readyGateOpenedAtMsRef = useRef(Date.now());
  const terminalActionInFlightRef = useRef(false);
  const manualExitRequestedRef = useRef(false);
  const pendingForfeitReasonRef = useRef<'timeout' | 'skip' | null>(null);
  const activeReadyGateKey = `${sessionId}:${eventId}`;
  const activeReadyGateKeyRef = useRef(activeReadyGateKey);
  const bothReadyObservedAtMsRef = useRef<number | null>(null);
  const prepareEntryHandoffStartedRef = useRef(false);
  const roomWarmupStartedRef = useRef(false);
  const duplicateNavSuppressionKeysRef = useRef(new Set<string>());
  const duplicateTerminalSuppressionKeysRef = useRef(new Set<string>());
  const nonRetryablePrepareFailureRef = useRef<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [prepareEntryStatus, setPrepareEntryStatus] = useState<PrepareEntryStatus>('idle');
  const [prepareEntryFailure, setPrepareEntryFailure] = useState<PrepareEntryFailure | null>(null);
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(null);
  const [nativeMediaDiagnostics, setNativeMediaDiagnostics] = useState(defaultNativeReadyGateMediaDiagnostics);
  const [nativePermissionDiagnostics, setNativePermissionDiagnostics] = useState(
    defaultNativeReadyGatePermissionDiagnostics,
  );

  const refreshNativeMediaDiagnostics = useCallback(async (permission: boolean | null = hasMediaPermission) => {
    const readyGateKey = activeReadyGateKeyRef.current;
    setNativeMediaDiagnostics((current) => ({
      ...current,
      cameraDeviceStatus: permission ? 'checking' : current.cameraDeviceStatus,
      microphoneDeviceStatus: permission ? 'checking' : current.microphoneDeviceStatus,
    }));
    const next = await inspectNativeReadyGateMediaDevices(permission);
    if (activeReadyGateKeyRef.current !== readyGateKey) return;
    setNativeMediaDiagnostics(next);
  }, [hasMediaPermission]);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    const markPermissionResult = (
      permissions: NativeReadyGatePermissionDiagnosticState,
      source: string,
    ) => {
      const ok = permissions.cameraPermissionStatus === 'ok' && permissions.microphonePermissionStatus === 'ok';
      setHasMediaPermission(ok);
      setPermissionsResolved(true);
      setNativePermissionDiagnostics(permissions);
      void refreshNativeMediaDiagnostics(ok);
      if (ok) {
        setVideoDatePermissionHandoff({
          sessionId,
          userId,
          platform: 'native',
          source,
        });
      }
    };
    if (Platform.OS === 'android') {
      const camOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const micOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (camOk && micOk) {
        markPermissionResult(
          { cameraPermissionStatus: 'ok', microphonePermissionStatus: 'ok' },
          'ready_gate_android_existing_grants',
        );
        return true;
      }
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const permissions: NativeReadyGatePermissionDiagnosticState = {
        cameraPermissionStatus:
          granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'blocked',
        microphonePermissionStatus:
          granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'blocked',
      };
      markPermissionResult(permissions, 'ready_gate_android_request');
      const ok = permissions.cameraPermissionStatus === 'ok' && permissions.microphonePermissionStatus === 'ok';
      return ok;
    }
    const camExisting = await Camera.getCameraPermissionsAsync();
    const micExisting = await Camera.getMicrophonePermissionsAsync();
    if (camExisting.status === 'granted' && micExisting.status === 'granted') {
      markPermissionResult(
        { cameraPermissionStatus: 'ok', microphonePermissionStatus: 'ok' },
        'ready_gate_native_existing_grants',
      );
      return true;
    }
    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const permissions: NativeReadyGatePermissionDiagnosticState = {
      cameraPermissionStatus: cam.status === 'granted' ? 'ok' : 'blocked',
      microphonePermissionStatus: mic.status === 'granted' ? 'ok' : 'blocked',
    };
    markPermissionResult(permissions, 'ready_gate_native_request');
    const ok = permissions.cameraPermissionStatus === 'ok' && permissions.microphonePermissionStatus === 'ok';
    return ok;
  }, [refreshNativeMediaDiagnostics, sessionId, userId]);

  const trackNativeReadyGateEvent = useCallback(
    (eventName: string, payload: Record<string, string | number | boolean | null | undefined>) => {
      trackEvent(eventName, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source_surface: 'ready_gate_overlay',
        ...payload,
      });
    },
    [eventId, sessionId],
  );

  const suppressDuplicateNav = useCallback(
    (source: string) => {
      const key = `${sessionId}:${source}`;
      if (duplicateNavSuppressionKeysRef.current.has(key)) return;
      duplicateNavSuppressionKeysRef.current.add(key);
      trackNativeReadyGateEvent(NativeReadyGateEvents.DUPLICATE_NAV_SUPPRESSED, {
        source,
        source_action: source,
        ready_gate_status: 'both_ready',
        reason: 'navigation_already_started',
        terminal: false,
      });
      rcBreadcrumb(RC_CATEGORY.readyGate, 'native_ready_gate_duplicate_nav_suppressed', {
        session_id: sessionId,
        event_id: eventId,
        source,
      });
    },
    [eventId, sessionId, trackNativeReadyGateEvent],
  );

  const suppressDuplicateTerminal = useCallback(
    (source: string, recoveryInput?: ReadyGateTerminalRecoveryInput) => {
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput ?? { reason: source });
      const key = `${sessionId}:${source}:${recovery.category}`;
      if (duplicateTerminalSuppressionKeysRef.current.has(key)) return;
      duplicateTerminalSuppressionKeysRef.current.add(key);
      trackNativeReadyGateEvent(NativeReadyGateEvents.DUPLICATE_TERMINAL_SUPPRESSED, {
        source,
        source_action: source,
        ready_gate_status: recoveryInput?.status ?? null,
        reason: recoveryInput?.reason ?? source,
        error_code: recoveryInput?.errorCode ?? recoveryInput?.code ?? null,
        inactive_reason: recoveryInput?.inactiveReason ?? null,
        terminal: true,
        terminal_category: recovery.category,
      });
      rcBreadcrumb(RC_CATEGORY.readyGate, 'native_ready_gate_duplicate_terminal_suppressed', {
        session_id: sessionId,
        event_id: eventId,
        source,
        terminal_category: recovery.category,
      });
    },
    [eventId, sessionId, trackNativeReadyGateEvent],
  );

  const startRoomWarmupAfterReady = useCallback(
    (source: string, readyGateStatus?: string | null) => {
      if (!videoDateRoomWarmupAfterReadyEnabled()) return;
      if (roomWarmupStartedRef.current || dateNavigationStartedRef.current || closedRef.current) return;
      // 'ready' is the freshly-minted mutual-swipe state. Pre-creating the
      // room here removes the room create/verify roundtrip from the ready-tap path.
      if (readyGateStatus && !['ready', 'ready_a', 'ready_b', 'both_ready'].includes(readyGateStatus)) {
        return;
      }
      if (readyGateStatus === 'both_ready' && prepareEntryHandoffStartedRef.current) return;
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
          vdbg('ready_gate_room_warmup_after_ready_skipped', {
            sessionId,
            eventId,
            userId,
            source,
            code: result.code,
            retryable: result.retryable,
          });
          return;
        }

        const permissionProven =
          hasMediaPermission === true || Boolean(getVideoDatePermissionHandoff(sessionId, userId));
        if (activeReadyGateKeyRef.current !== readyGateKey) return;
        if (!permissionProven || dateNavigationStartedRef.current || closedRef.current) {
          vdbg('ready_gate_daily_prewarm_after_room_warmup_skipped', {
            sessionId,
            eventId,
            userId,
            source,
            reason: permissionProven ? 'closed_or_navigating' : 'permission_not_proven',
          });
          return;
        }

        const prewarm = startNativeVideoDateDailyPrewarm({
          sessionId,
          userId,
          eventId,
          roomName: result.data.room_name,
          roomUrl: result.data.room_url,
          source: 'ready_gate_room_warmup_success',
        });
        vdbg('ready_gate_daily_prewarm_after_room_warmup', {
          sessionId,
          eventId,
          userId,
          source,
          roomName: result.data.room_name,
          ok: prewarm.ok,
          reason: prewarm.ok === true ? null : prewarm.reason,
        });
        // The ReadyGate warms camera/token/preauth only; it must never perform a
        // real Daily join. A lobby-side join would start the backend handshake/
        // warm-up clock before the user is on a stable /date route, causing
        // handshake_timeout. The real join + mark_video_date_daily_joined is
        // owned solely by /date (useVideoCall.startCall).
      })();
    },
    [activeReadyGateKey, eventId, hasMediaPermission, sessionId, userId],
  );

  const preloadVideoDateRoute = useCallback(
    (sourceAction: string) => {
      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: 'native',
        eventId,
        sourceSurface: 'ready_gate_overlay',
        checkpoint: 'video_date_route_preload_started',
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: 'video_date_route_preload_started',
          sourceAction,
          outcome: 'success',
        }),
      );
      try {
        router.prefetch(`/date/${sessionId}` as Href);
        const successContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId,
          sourceSurface: 'ready_gate_overlay',
          checkpoint: 'video_date_route_preload_success',
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: successContext,
            checkpoint: 'video_date_route_preload_success',
            sourceAction,
            outcome: 'success',
          }),
        );
        vdbg('video_date_route_preloaded', { sessionId, eventId, sourceAction });
      } catch (error) {
        vdbg('video_date_route_preload_failed', {
          sessionId,
          eventId,
          sourceAction,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    },
    [eventId, sessionId],
  );

  useLayoutEffect(() => {
    activeReadyGateKeyRef.current = activeReadyGateKey;
  }, [activeReadyGateKey]);

  const startPrepareEntryHandoff = useCallback(
    (source: string) => {
      if (closedRef.current || prepareEntryHandoffStartedRef.current) {
        suppressDuplicateNav(source);
        return;
      }
      prepareEntryHandoffStartedRef.current = true;
      setIsTransitioning(true);
      setPrepareEntryStatus('preparing');
      setPrepareEntryFailure(null);
      const observedAtMs = Date.now();
      const bothReadyCheckpoint =
        source === 'both_ready_observed_via_rpc_short_circuit'
          ? 'both_ready_observed_via_rpc_short_circuit'
          : 'both_ready_observed';
      bothReadyObservedAtMsRef.current = observedAtMs;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_observed', {
        event_id: eventId,
        session_id: sessionId,
        source,
      });
      trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY_OBSERVED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: 'ready_gate_overlay',
        source_action: bothReadyCheckpoint,
      });
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: 'native',
        eventId,
        sourceSurface: 'ready_gate_overlay',
        checkpoint: bothReadyCheckpoint,
        nowMs: observedAtMs,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: bothReadyCheckpoint,
          sourceAction: bothReadyCheckpoint,
          outcome: 'success',
        }),
      );
      vdbg('ready_gate_both_ready_observed', {
        sessionId,
        eventId,
        source,
      });
      preloadVideoDateRoute(bothReadyCheckpoint);

      const navigateWithLatency = (navigateSource: string) => {
        if (dateNavigationStartedRef.current) {
          suppressDuplicateNav(navigateSource);
          return;
        }
        dateNavigationStartedRef.current = true;
        closedRef.current = true;
        setPrepareEntryStatus('idle');
        setPrepareEntryFailure(null);
        const navContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId,
          sourceSurface: 'ready_gate_overlay',
          checkpoint: 'navigation_started',
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: navContext,
            checkpoint: 'navigation_started',
            sourceAction: navigateSource,
            outcome: 'success',
          }),
        );
        onNavigateToDate(sessionId);
      };

      const slowWaitTimer = setTimeout(() => {
        if (dateNavigationStartedRef.current || !prepareEntryHandoffStartedRef.current) return;
        setPrepareEntryStatus('slow');
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_SLOW_WAIT, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          source_surface: 'ready_gate_overlay',
          source_action: 'prepare_entry_slow_wait',
          elapsed_ms: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        });
        vdbg('ready_gate_prepare_entry_slow_wait', {
          sessionId,
          eventId,
          elapsedMs: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
        });
        void emitNativeVideoDateClientStuckState({
          sessionId,
          eventName: 'ready_gate_handoff_slow',
          latencyMs: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
          payload: {
            source_surface: 'ready_gate_overlay',
            source_action: 'prepare_entry_slow_wait',
            elapsed_ms: VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
          },
        });
      }, VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS);

      void (async () => {
        try {
          for (let attempt = 0; attempt <= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length; attempt += 1) {
            if (dateNavigationStartedRef.current || closedRef.current) return;
            setPrepareEntryStatus(attempt === 0 ? 'preparing' : 'retrying');
            const result = await prepareVideoDateEntry(sessionId, {
              eventId,
              userId,
              source: attempt === 0 ? `ready_gate_${source}` : `ready_gate_${source}_retry`,
              force: attempt > 0,
              bothReadyObservedAtMs: observedAtMs,
            });
            if (dateNavigationStartedRef.current || closedRef.current) return;
            if (result.ok === true) {
              const prewarm = startNativeVideoDateDailyPrewarm({
                sessionId,
                userId,
                eventId,
                roomName: result.data.room_name,
                roomUrl: result.data.room_url,
                source: 'ready_gate_prepare_success',
              });
              vdbg('ready_gate_daily_prewarm_prepare_success', {
                sessionId,
                eventId,
                userId,
                roomName: result.data.room_name,
                ok: prewarm.ok,
                reason: prewarm.ok === true ? null : prewarm.reason,
              });
              // Pre-authenticate only — do NOT join Daily from the lobby. The
              // real join (which starts the backend handshake clock) is owned by
              // /date (useVideoCall.startCall) so the full warm-up window only
              // begins once the user is on the stable date route.
              void preAuthNativeVideoDateDailyPrewarm({
                sessionId,
                userId,
                eventId,
                roomName: result.data.room_name,
                roomUrl: result.data.room_url,
                token: result.data.token,
                source: 'ready_gate_prepare_success',
              });
              if (dateNavigationStartedRef.current || closedRef.current) return;
              clearTimeout(slowWaitTimer);
              navigateWithLatency(`${source}_prepare_success`);
              return;
            }

            const recoveryInput: ReadyGateTerminalRecoveryInput = {
              code: result.code,
              errorCode: result.code,
              reason: result.message ?? null,
              source: 'prepare_entry',
            };
            const inactivePrepareBlocker = isReadyGatePrepareEntryNonRetryable(recoveryInput);
            const retryable = !inactivePrepareBlocker && shouldRetryVideoDateEntryHandoffFailure(result);
            const exhausted = !retryable || attempt >= VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS.length;
            const latencyMs = Math.max(0, Date.now() - observedAtMs);
            trackNativeReadyGateEvent(NativeReadyGateEvents.PREPARE_ENTRY_FAILURE, {
              source,
              source_action: 'prepare_entry_failed_no_nav',
              code: result.code,
              error_code: result.code,
              reason: result.message ?? null,
              httpStatus: result.httpStatus ?? null,
              retryable,
              terminal: !retryable,
              attempt: attempt + 1,
              attempt_count: attempt + 1,
              latency_ms: latencyMs,
            });
            if (inactivePrepareBlocker) {
              const inactiveKey = `${sessionId}:${result.code}:prepare_entry`;
              if (nonRetryablePrepareFailureRef.current !== inactiveKey) {
                nonRetryablePrepareFailureRef.current = inactiveKey;
                trackNativeReadyGateEvent(NativeReadyGateEvents.PREPARE_ENTRY_EVENT_INACTIVE, {
                  source,
                  source_action: 'prepare_entry_event_inactive',
                  code: result.code,
                  error_code: result.code,
                  reason: result.message ?? null,
                  retryable: false,
                  terminal: true,
                  attempt: attempt + 1,
                  latency_ms: latencyMs,
                });
                rcBreadcrumb(RC_CATEGORY.readyGate, 'native_prepare_entry_event_inactive', {
                  event_id: eventId,
                  session_id: sessionId,
                  source,
                  code: result.code,
                  attempt: attempt + 1,
                });
              }
            }
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId,
              source_surface: 'ready_gate_overlay',
              source_action: 'prepare_entry_failed_no_nav',
              code: result.code,
              reason_code: result.code,
              httpStatus: result.httpStatus ?? null,
              retryable,
              attempt: attempt + 1,
              attempt_count: attempt + 1,
              exhausted,
              entry_attempt_id: result.entryAttemptId ?? null,
            });
            rcBreadcrumb(RC_CATEGORY.readyGate, 'prepare_date_entry_failed_before_nav', {
              event_id: eventId,
              session_id: sessionId,
              source,
              code: result.code,
              retryable,
              exhausted,
              entry_attempt_id: result.entryAttemptId ?? null,
            });
            vdbg('ready_gate_prepare_entry_failed_no_nav', {
              sessionId,
              eventId,
              code: result.code,
              retryable,
              attempt: attempt + 1,
              exhausted,
              entryAttemptId: result.entryAttemptId ?? null,
            });

            if (exhausted) {
              clearTimeout(slowWaitTimer);
              void emitNativeVideoDateClientStuckState({
                sessionId,
                eventName: 'prepare_date_entry_failed',
                payload: {
                  source_surface: 'ready_gate_overlay',
                  source_action: 'prepare_entry_failed_no_nav',
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
              setIsTransitioning(false);
              setPrepareEntryStatus('failed');
              setPrepareEntryFailure({
                code: result.code,
                retryable,
                httpStatus: result.httpStatus,
              });
              prepareEntryHandoffStartedRef.current = !retryable;
              return;
            }

            const latestTruth = await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
            if (isTerminalReadyGateTruth(latestTruth)) {
              clearTimeout(slowWaitTimer);
              trackNativeReadyGateEvent(NativeReadyGateEvents.PREPARE_ENTRY_FAILURE, {
                source,
                source_action: 'prepare_entry_retry_cancelled_terminal',
                code: 'SESSION_ENDED',
                error_code: 'SESSION_ENDED',
                reason: 'canonical_truth_terminal',
                httpStatus: null,
                retryable: false,
                terminal: true,
                attempt: attempt + 1,
                attempt_count: attempt + 1,
                latency_ms: Math.max(0, Date.now() - observedAtMs),
              });
              rcBreadcrumb(RC_CATEGORY.readyGate, 'prepare_date_entry_retry_cancelled_terminal', {
                event_id: eventId,
                session_id: sessionId,
                source,
                ready_gate_status: latestTruth?.ready_gate_status ?? null,
                vs_state: latestTruth?.state ?? null,
                vs_phase: latestTruth?.phase ?? null,
              });
              setIsTransitioning(false);
              setPrepareEntryStatus('failed');
              setPrepareEntryFailure({
                code: 'SESSION_ENDED',
                retryable: false,
              });
              prepareEntryHandoffStartedRef.current = true;
              onLobbyUserMessage?.(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, 'info');
              return;
            }

            await sleep(VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS[attempt]);
          }
        } finally {
          clearTimeout(slowWaitTimer);
        }
      })();
    },
    [eventId, onLobbyUserMessage, onNavigateToDate, preloadVideoDateRoute, sessionId, suppressDuplicateNav, trackNativeReadyGateEvent, userId],
  );

  const navigateToDateForSurveyRecovery = useCallback(
    (source: string) => {
      if (dateNavigationStartedRef.current || closedRef.current) {
        suppressDuplicateNav(source);
        return;
      }
      dateNavigationStartedRef.current = true;
      closedRef.current = true;
      setIsTransitioning(true);
      setPrepareEntryStatus('idle');
      setPrepareEntryFailure(null);
      rcBreadcrumb(RC_CATEGORY.readyGate, 'pending_survey_navigation_started', {
        session_id: sessionId,
        event_id: eventId,
        source,
      });
      vdbg('ready_gate_pending_survey_navigate_to_date', {
        sessionId,
        eventId,
        source,
      });
      router.replace(`/date/${sessionId}` as Href);
    },
    [eventId, sessionId, suppressDuplicateNav],
  );

  const reconcileFromCanonicalTruth = useCallback(
    async (source: string) => {
      const [vs, regRes] = await Promise.all([
        fetchVideoSessionDateEntryTruthCoalesced(sessionId),
        supabase
          .from('event_registrations')
          .select('queue_status, current_room_id')
          .eq('event_id', eventId)
          .eq('profile_id', userId)
          .eq('current_room_id', sessionId)
          .maybeSingle(),
      ]);
      const reg = regRes.data;
      const recovery = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: vs,
        platform: 'native',
        surface: 'ready_gate',
      });
      const decision = recovery.routeDecision;
      const canAttemptDaily = recovery.canAttemptDaily === true;
      const routedTo =
        recovery.action === 'go_date'
          ? 'date'
          : recovery.action === 'go_survey'
            ? 'survey'
          : recovery.action === 'go_ready_gate'
            ? 'ready'
            : 'none';
      rcBreadcrumb(RC_CATEGORY.readyGate, 'date_route_decision', {
        session_id: sessionId,
        user_id: userId,
        decision,
        can_attempt_daily: canAttemptDaily,
        routed_to: routedTo,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        handshake_started_at: Boolean(vs?.handshake_started_at),
        ready_gate_status: vs?.ready_gate_status ?? null,
        ready_gate_expires_at: vs?.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
      });
      vdbg('ready_gate_date_route_decision', {
        sessionId,
        userId,
        eventId,
        source,
        decision,
        canAttemptDaily,
        routed_to: routedTo,
        readyGateStatus: vs?.ready_gate_status ?? null,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        state: vs?.state ?? null,
        phase: vs?.phase ?? null,
      });

      const readyGateStatus = vs?.ready_gate_status ?? null;
      if (
        readyGateStatus === 'ready' &&
        !vs?.ended_at &&
        !roomWarmupStartedRef.current &&
        !dateNavigationStartedRef.current &&
        !closedRef.current
      ) {
        startRoomWarmupAfterReady('mutual_swipe_pre_create', readyGateStatus);
      }

      if (canAttemptDaily || decision === 'navigate_date') {
        closedRef.current = false;
        startPrepareEntryHandoff(source);
        return true;
      }

      if (recovery.action === 'go_survey') {
        navigateToDateForSurveyRecovery('pending_survey_recovery');
        return true;
      }

      if (decision === 'navigate_ready') {
        return false;
      }

      if (decision === 'ended' || decision === 'stay_lobby') {
        if (!invalidSessionNotifiedRef.current) {
          invalidSessionNotifiedRef.current = true;
          onLobbyUserMessage?.(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, 'info');
        }
        closedRef.current = true;
        onClose();
        return true;
      }

      return false;
    },
    [eventId, navigateToDateForSurveyRecovery, onClose, onLobbyUserMessage, sessionId, startPrepareEntryHandoff, startRoomWarmupAfterReady, userId]
  );

  const handleBothReady = useCallback((
    sourceAction: 'both_ready_observed' | 'both_ready_observed_via_rpc_short_circuit' = 'both_ready_observed',
  ) => {
    // Idempotent across the onBothReady edge and the both-ready liveness guard:
    // once the handoff/navigation has started, don't re-fire analytics or the
    // handoff. Manual retry and reconcile recovery call startPrepareEntryHandoff()
    // directly, so they are unaffected by this guard.
    if (closedRef.current || prepareEntryHandoffStartedRef.current || dateNavigationStartedRef.current) return;
    const source = sourceAction === 'both_ready_observed_via_rpc_short_circuit'
      ? 'mark_ready_rpc'
      : 'both_ready';
    const handoffSource = sourceAction === 'both_ready_observed_via_rpc_short_circuit'
      ? sourceAction
      : 'both_ready';
    rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_seen', { event_id: eventId, session_id: sessionId, source_action: sourceAction });
    rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_both_ready', { eventId, source_action: sourceAction });
    trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source,
      source_surface: 'ready_gate_overlay',
      source_action: sourceAction,
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_BOTH_READY, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source,
      source_surface: 'ready_gate_overlay',
      source_action: sourceAction,
    });
    vdbg('lobby_navigate_to_date', {
      trigger: 'ready_gate_overlay_both_ready',
      sessionId,
      eventId,
      sourceAction,
    });
    startPrepareEntryHandoff(handoffSource);
  }, [sessionId, eventId, startPrepareEntryHandoff]);

  const handleForfeited = useCallback(
    async (_reason: 'timeout' | 'skip', detail?: ReadyGateTerminalDetail) => {
      const recoveryInput: ReadyGateTerminalRecoveryInput = {
        status: detail?.status ?? (_reason === 'timeout' ? 'expired' : 'forfeited'),
        reason: detail?.reason ?? (_reason === 'timeout' ? 'ready_gate_expired' : 'ready_gate_forfeit'),
        errorCode: detail?.errorCode ?? detail?.code ?? null,
        code: detail?.code ?? null,
        inactiveReason: detail?.inactiveReason ?? null,
        terminal: detail?.terminal ?? true,
        source: 'ready_gate_terminal',
      };
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
      if (closedRef.current || dateNavigationStartedRef.current) {
        suppressDuplicateTerminal('ready_gate_terminal', recoveryInput);
        return;
      }
      const reason = pendingForfeitReasonRef.current ?? _reason;
      pendingForfeitReasonRef.current = null;
      closedRef.current = true;
      terminalActionInFlightRef.current = false;
      setTerminalActionPending(false);
      setTerminalActionError(null);
      rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_forfeited', { reason, eventId });
      if (!terminalTimeoutRef.current) {
        terminalTimeoutRef.current = true;
        trackNativeReadyGateEvent(NativeReadyGateEvents.TERMINAL, {
          source_action: 'ready_gate_terminal',
          ready_gate_status: recoveryInput.status ?? null,
          reason: recoveryInput.reason ?? reason,
          error_code: recoveryInput.errorCode ?? recoveryInput.code ?? null,
          inactive_reason: recoveryInput.inactiveReason ?? null,
          terminal: true,
          terminal_category: recovery.category,
          retryable: recovery.retryable,
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_TIMEOUT, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason,
          reason_code: recoveryInput.reason ?? reason,
        });
      }
      if (manualExitRequestedRef.current) {
        onManualExitConfirmed?.(sessionId);
      }
      manualExitRequestedRef.current = false;
      onLobbyUserMessage?.(recovery.toast, 'info');
      onClose();
    },
    [
      eventId,
      onClose,
      onManualExitConfirmed,
      sessionId,
      onLobbyUserMessage,
      suppressDuplicateTerminal,
      trackNativeReadyGateEvent,
    ],
  );

  const {
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    partnerName,
    snoozedByPartner,
    expiresAt,
    serverNowMs,
    clientSyncedAtMs,
    phaseDeadlineAtMs,
    markReady,
    snooze,
    forfeit,
    syncSession,
    retryBroadcastGapRecovery,
    isBothReady,
    realtimeDegraded,
    sequenceGapUnresolved,
    readyGateClockEnabled,
  } = useReadyGate(sessionId, userId, {
    eventId,
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  useEffect(() => {
    closedRef.current = false;
    dateNavigationStartedRef.current = false;
    invalidSessionNotifiedRef.current = false;
    rgImpressionRef.current = false;
    permissionBlockedRef.current = false;
    openingPartnerWaitRef.current = false;
    openingPermissionWaitRef.current = false;
    terminalTimeoutRef.current = false;
    expirySyncInFlightRef.current = false;
    expirySyncRetryAtMsRef.current = 0;
    readyGateOpenedAtMsRef.current = Date.now();
    terminalActionInFlightRef.current = false;
    manualExitRequestedRef.current = false;
    pendingForfeitReasonRef.current = null;
    bothReadyObservedAtMsRef.current = null;
    prepareEntryHandoffStartedRef.current = false;
    roomWarmupStartedRef.current = false;
    duplicateNavSuppressionKeysRef.current.clear();
    duplicateTerminalSuppressionKeysRef.current.clear();
    nonRetryablePrepareFailureRef.current = null;
    setTimeLeft(GATE_TIMEOUT_SEC);
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setPermissionsResolved(false);
    setHasMediaPermission(null);
    setPrepareEntryStatus('idle');
    setPrepareEntryFailure(null);
    setTerminalActionPending(false);
    setTerminalActionError(null);
    setNativeMediaDiagnostics(defaultNativeReadyGateMediaDiagnostics());
    setNativePermissionDiagnostics(defaultNativeReadyGatePermissionDiagnostics());
    if (!rgImpressionRef.current) {
      rgImpressionRef.current = true;
      const latencyContext = startReadyGateToDateLatencyContext({
        platform: 'native',
        sessionId,
        eventId,
        sourceSurface: 'ready_gate_overlay',
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_STARTED,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: 'ready_gate_impression',
          sourceAction: 'impression',
          outcome: 'success',
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_IMPRESSION, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source_surface: 'ready_gate_overlay',
        source_action: 'impression',
      });
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_SHOWN, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source_surface: 'ready_gate_overlay',
        source_action: 'impression',
      });
    }
    preloadVideoDateRoute('ready_gate_open');
    return () => {
      if (!dateNavigationStartedRef.current) {
        destroyNativeVideoDateDailyPrewarm(sessionId, userId, 'ready_gate_unmount_before_date_navigation');
      }
    };
  }, [sessionId, eventId, preloadVideoDateRoute, userId]);

  // Both-ready liveness guard: if the orchestrator reports both participants
  // ready but the one-shot onBothReady edge was missed (e.g. realtime degraded),
  // still drive the prepare-entry handoff so the gate cannot silently stall on
  // "Both ready. Connecting you now…". It must run after the session reset
  // effect above so reset cannot clear the in-flight handoff it starts.
  useEffect(() => {
    if (!isBothReady) return;
    handleBothReady('both_ready_observed');
  }, [isBothReady, handleBothReady]);

  useEffect(() => {
    const sync = () => {
      void syncSession();
    };
    sync();
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') sync();
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [sessionId, syncSession]);

  useEffect(() => {
    if (permissionsResolved) return;
    let cancelled = false;
    void (async () => {
      const ok = await requestMediaPermissions();
      if (cancelled) return;
      if (!ok) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_permissions_denied', { eventId });
        if (!permissionBlockedRef.current) {
          permissionBlockedRef.current = true;
          trackEvent(LobbyPostDateEvents.READY_GATE_PERMISSION_BLOCKED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissionsResolved, requestMediaPermissions, eventId, sessionId]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
    if (!iAmReady || isBothReady || isTransitioning) return;
    const timer = setTimeout(() => {
      void reconcileFromCanonicalTruth('overlay_ready_wait_threshold');
    }, READY_GATE_TRUTH_RECONCILE_MS);
    return () => clearTimeout(timer);
  }, [iAmReady, isBothReady, isTransitioning, reconcileFromCanonicalTruth]);

  useEffect(() => {
    if (permissionsResolved) return;
    if (openingPermissionWaitRef.current) return;
    openingPermissionWaitRef.current = true;
    trackEvent(LobbyPostDateEvents.READY_GATE_OPENING_WAIT_IMPRESSION, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      state: 'permissions_pending',
    });
  }, [eventId, permissionsResolved, sessionId]);

  useEffect(() => {
    if (!permissionsResolved || hasMediaPermission !== true || isTransitioning || isBothReady) return;
    if (!iAmReady || !partnerReadyKnown || partnerReady || snoozedByPartner) return;
    if (openingPartnerWaitRef.current) return;
    openingPartnerWaitRef.current = true;
    trackEvent(LobbyPostDateEvents.READY_GATE_OPENING_WAIT_IMPRESSION, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      state: 'awaiting_partner',
    });
  }, [
    eventId,
    hasMediaPermission,
    iAmReady,
    isBothReady,
    isTransitioning,
    partnerReady,
    partnerReadyKnown,
    permissionsResolved,
    sessionId,
    snoozedByPartner,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [regResult, vs] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('queue_status')
          .eq('event_id', eventId)
          .eq('profile_id', userId)
          .maybeSingle(),
        fetchVideoSessionDateEntryTruthCoalesced(sessionId),
      ]);
      const reg = regResult.data;
      if (cancelled) return;
      const readyGateStatus = vs?.ready_gate_status ?? null;
      if (
        readyGateStatus === 'ready' &&
        !vs?.ended_at &&
        !roomWarmupStartedRef.current &&
        !dateNavigationStartedRef.current &&
        !closedRef.current
      ) {
        startRoomWarmupAfterReady('mutual_swipe_pre_create', readyGateStatus);
      }
      const recovery = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: vs,
        platform: 'native',
        surface: 'ready_gate',
      });
      const decision = recovery.routeDecision;
      const canAttemptDaily = recovery.canAttemptDaily === true;
      if (recovery.action === 'go_date') {
        await reconcileFromCanonicalTruth('overlay_initial_daily_startable_check');
        return;
      }
      if (recovery.action === 'go_survey') {
        navigateToDateForSurveyRecovery('overlay_initial_pending_survey');
        return;
      }
      if (!vs || recovery.action !== 'go_ready_gate') {
        trackEvent(LobbyPostDateEvents.READY_GATE_STALE_CLOSE, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason: !vs
            ? 'missing_session'
            : decision === 'navigate_date'
              ? 'session_started'
            : decision === 'ended'
              ? 'session_ended'
              : 'session_not_ready_gate_eligible',
        });
        await reconcileFromCanonicalTruth('overlay_initial_stale_check');
        return;
      }
      if (reg?.queue_status !== 'in_ready_gate') {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'overlay_registration_stale_but_truth_ready', {
          session_id: sessionId,
          event_id: eventId,
          queue_status: reg?.queue_status ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, navigateToDateForSurveyRecovery, onClose, onLobbyUserMessage, reconcileFromCanonicalTruth, sessionId, startRoomWarmupAfterReady, userId]);

  const handleSkip = useCallback(async (reason: 'skip' = 'skip') => {
    if (dateNavigationStartedRef.current || closedRef.current || terminalActionInFlightRef.current) return;
    terminalActionInFlightRef.current = true;
    pendingForfeitReasonRef.current = reason;
    setTerminalActionPending(true);
    setTerminalActionError(null);
    const dismissVariant = iAmReady ? 'cancel_go_back' : 'skip_this_one';
    trackEvent(LobbyPostDateEvents.READY_GATE_NOT_NOW_TAP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      dismiss_variant: dismissVariant,
    });
    manualExitRequestedRef.current = true;
    try {
      const result = await forfeit();
      if (!result.ok) throw new Error('ready_gate_forfeit_failed');
      if (result.status === 'both_ready') {
        manualExitRequestedRef.current = false;
        terminalActionInFlightRef.current = false;
        pendingForfeitReasonRef.current = null;
        setTerminalActionPending(false);
        trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_SUCCESS, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          source_surface: 'ready_gate_overlay',
          source_action: dismissVariant,
          outcome: 'both_ready_race',
          reason: 'both_ready',
        });
        return;
      }
      const terminal =
        result.terminal === true ||
        result.isTerminal === true ||
        result.status === 'forfeited' ||
        result.status === 'expired';
      if (!terminal) throw new Error('ready_gate_forfeit_not_terminal');
      trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_SUCCESS, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source_surface: 'ready_gate_overlay',
        source_action: dismissVariant,
        outcome: 'success',
        reason: 'forfeit',
      });
      await handleForfeited(result.status === 'expired' ? 'timeout' : reason, {
        status: result.status ?? 'forfeited',
        reason: result.reason ?? 'ready_gate_forfeit',
        inactiveReason: result.inactiveReason ?? null,
        errorCode: result.errorCode ?? result.code ?? null,
        code: result.code ?? null,
        terminal: true,
      });
    } catch (e) {
      terminalActionInFlightRef.current = false;
      pendingForfeitReasonRef.current = null;
      manualExitRequestedRef.current = false;
      if (closedRef.current || dateNavigationStartedRef.current) return;
      const message = "We couldn't step away. Check your connection and try again.";
      setTerminalActionPending(false);
      setTerminalActionError(message);
      rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_forfeit_failed_kept_open', {
        session_id: sessionId,
        event_id: eventId,
        message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
      });
      trackEvent(LobbyPostDateEvents.READY_GATE_TERMINAL_ACTION_FAILURE, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        source_surface: 'ready_gate_overlay',
        source_action: dismissVariant,
        outcome: 'failure',
        reason_code: 'ready_gate_forfeit_failed',
        retryable: true,
        error_name: e instanceof Error ? e.name : 'unknown',
      });
      trackNativeReadyGateEvent(NativeReadyGateEvents.TRANSITION_FAILURE, {
        action: 'forfeit',
        source_action: dismissVariant,
        reason: 'ready_gate_forfeit_failed',
        error_code: 'ready_gate_forfeit_failed',
        terminal: false,
      });
    }
  }, [eventId, forfeit, handleForfeited, iAmReady, sessionId, trackNativeReadyGateEvent]);

  useEffect(() => {
    if (isTransitioning || iAmReady || markingReady || snoozedByPartner || terminalActionPending) return;
    const tick = () => {
      const countdown = getReadyGateCountdownFromServerClock({
        expiresAt: readyGateClockEnabled ? phaseDeadlineAtMs ?? expiresAt : expiresAt,
        serverNowMs: readyGateClockEnabled ? serverNowMs : null,
        clientSyncedAtMs: readyGateClockEnabled ? clientSyncedAtMs : null,
        fallbackDeadlineMs: readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
        fallbackSeconds: GATE_TIMEOUT_SEC,
      });
      const next = countdown.remainingSeconds;
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
              rcBreadcrumb(RC_CATEGORY.readyGate, 'countdown_expiry_sync_deferred', {
                session_id: sessionId,
                event_id: eventId,
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
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
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
    readyGateClockEnabled,
    syncSession,
    sessionId,
    eventId,
  ]);

  const progress = getReadyGateCountdownProgress(timeLeft, GATE_TIMEOUT_SEC);
  const dashOffset = CIRC * (1 - progress);

  const displayName = partnerName || 'someone';
  const readyGateReadinessCopy = getReadyGateReadinessStatusCopy({
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    isBothReady,
    markingReady,
    partnerName: displayName,
  });
  const showConnectingReadinessCopy = readyGateReadinessCopy.key === 'both_ready_connecting';
  const showReadyActionControls = !iAmReady && !showConnectingReadinessCopy;
  const readinessStatusIcon = showConnectingReadinessCopy
    ? 'sparkles'
    : readyGateReadinessCopy.key === 'syncing'
      ? 'time-outline'
      : 'checkmark-circle';
  const retryPrepareEntry = () => {
    if (dateNavigationStartedRef.current) return;
    prepareEntryHandoffStartedRef.current = false;
    setPrepareEntryFailure(null);
    setPrepareEntryStatus('preparing');
    setIsTransitioning(true);
    startPrepareEntryHandoff('manual_retry');
  };
  const prepareCopy = getVideoDateEntryHandoffStatusCopy(
    prepareEntryStatus,
    prepareEntryFailure ? prepareEntryFailureMessage(prepareEntryFailure.code) : null,
  );
  const diagnosticChecklist = resolveReadyGateDiagnosticChecklist({
    platform: 'native',
    partnerName: displayName,
    cameraPermissionStatus: permissionsResolved
      ? nativePermissionDiagnostics.cameraPermissionStatus
      : 'checking',
    microphonePermissionStatus: permissionsResolved
      ? nativePermissionDiagnostics.microphonePermissionStatus
      : 'checking',
    cameraDeviceStatus: nativeMediaDiagnostics.cameraDeviceStatus,
    microphoneDeviceStatus: nativeMediaDiagnostics.microphoneDeviceStatus,
    // Neutral "waiting" until the prepare-entry handoff actually begins; only
    // "checking" while it is running; "failed" on terminal failure.
    videoProviderStatus:
      prepareEntryStatus === 'failed'
        ? 'failed'
        : prepareEntryStatus !== 'idle'
          ? 'checking'
          : 'waiting',
    realtimeSyncStatus: realtimeDegraded || sequenceGapUnresolved ? 'warning' : 'ok',
    partnerReadinessStatus: isBothReady || partnerReady ? 'ok' : iAmReady ? 'warning' : 'checking',
  });
  const handleDiagnosticAction = (row: ReadyGateDiagnosticCopy) => {
    if (terminalActionPending) return;
    switch (row.actionKind) {
      case 'open_settings':
        void Linking.openSettings().catch(() => {
          void requestMediaPermissions();
        });
        return;
      case 'request_permission':
        void requestMediaPermissions();
        return;
      case 'retry':
        if (row.key === 'video_provider' && prepareEntryFailure?.retryable) {
          retryPrepareEntry();
          return;
        }
        void refreshNativeMediaDiagnostics();
        return;
      case 'check_connection':
        void syncSession();
        void retryBroadcastGapRecovery('diagnostic_retry');
        return;
      case 'none':
      case 'wait':
        return;
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { void handleSkip(); }}>
      <SafeAreaView
        style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.8)' }]}
        pointerEvents="auto"
        accessibilityViewIsModal
      >
        <ScrollView
          contentContainerStyle={styles.backdropContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        {permissionsResolved && hasMediaPermission === false ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Ionicons name="videocam-off-outline" size={34} color={theme.textSecondary} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.md }]}>Camera and mic required</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Allow camera and microphone access to join this date.
            </Text>
            <ReadyGateDiagnosticChecklist
              rows={diagnosticChecklist.rows}
              theme={theme}
              actionDisabled={terminalActionPending}
              onAction={handleDiagnosticAction}
            />
            {terminalActionError ? (
              <Text style={[styles.terminalError, { color: theme.danger }]}>{terminalActionError}</Text>
            ) : null}
            <VibelyButton
              label="Enable permissions"
              onPress={() => {
                void requestMediaPermissions();
              }}
              variant="primary"
              size="lg"
              style={styles.readyBtn}
              disabled={terminalActionPending}
            />
            <Pressable
              onPress={() => { void handleSkip(); }}
              disabled={terminalActionPending}
              accessibilityRole="button"
              accessibilityLabel="Back to lobby"
              style={({ pressed }) => [
                styles.skipWrap,
                terminalActionPending && { opacity: 0.5 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                {terminalActionPending ? 'Leaving...' : 'Back to lobby'}
              </Text>
            </Pressable>
          </Card>
        ) : !permissionsResolved ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>Opening Ready Gate...</Text>
            <Text style={[styles.permissionLoadingSub, { color: theme.textSecondary }]}>
              Checking camera and microphone...
            </Text>
          </Card>
        ) : prepareEntryStatus === 'failed' && prepareEntryFailure ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Ionicons name="alert-circle-outline" size={34} color={theme.textSecondary} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.md }]}>{prepareCopy.title}</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {prepareCopy.body}
            </Text>
            <ReadyGateDiagnosticChecklist
              rows={diagnosticChecklist.rows}
              theme={theme}
              actionDisabled={terminalActionPending}
              onAction={handleDiagnosticAction}
            />
            {terminalActionError ? (
              <Text style={[styles.terminalError, { color: theme.danger }]}>{terminalActionError}</Text>
            ) : null}
            {prepareEntryFailure.retryable ? (
              <VibelyButton
                label="Try again"
                onPress={retryPrepareEntry}
                variant="primary"
                size="lg"
                style={styles.readyBtn}
                disabled={terminalActionPending}
              />
            ) : null}
            <Pressable
              onPress={() => { void handleSkip(); }}
              disabled={terminalActionPending}
              accessibilityRole="button"
              accessibilityLabel="Back to lobby"
              style={({ pressed }) => [
                styles.skipWrap,
                terminalActionPending && { opacity: 0.5 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                {terminalActionPending ? 'Leaving...' : 'Back to lobby'}
              </Text>
            </Pressable>
          </Card>
        ) : isTransitioning || isBothReady || prepareEntryStatus !== 'idle' ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>
              {prepareCopy.title}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: spacing.sm, marginBottom: 0 }]}>
              {prepareCopy.body}
            </Text>
          </Card>
        ) : (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              You matched with {displayName}.
            </Text>

            <View
              style={[
                styles.avatarWrap,
                { borderColor: withAlpha(theme.tint, 0.31), backgroundColor: theme.surfaceSubtle },
              ]}
            >
              {partnerImageUri ? (
                <>
                  <Image source={{ uri: partnerImageUri }} style={styles.avatarImage} />
                  <View style={styles.avatarNameScrim} pointerEvents="none">
                    <Text style={styles.avatarNameText} numberOfLines={1}>
                      {displayName}
                    </Text>
                  </View>
                </>
              ) : (
                <Ionicons name="person" size={48} color={theme.textSecondary} />
              )}
            </View>

            {partnerReady && !iAmReady ? (
              <View style={styles.partnerReadyRow}>
                <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                <Text style={[styles.partnerReadyText, { color: theme.success }]}>
                  {displayName} is ready!
                </Text>
              </View>
            ) : null}

            {snoozedByPartner ? (
              <View style={styles.partnerReadyRow}>
                <Ionicons name="time-outline" size={18} color={theme.textSecondary} />
                <Text style={[styles.subtleLine, { color: theme.textSecondary }]}>
                  {displayName} needs a moment...
                </Text>
              </View>
            ) : null}

            {terminalActionError ? (
              <Text style={[styles.terminalError, { color: theme.danger }]}>{terminalActionError}</Text>
            ) : null}

            <ReadyGateDiagnosticChecklist
              rows={diagnosticChecklist.rows}
              theme={theme}
              actionDisabled={terminalActionPending}
              onAction={handleDiagnosticAction}
            />

            {showReadyActionControls ? (
              <>
                <View style={styles.ringWrap}>
                  <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
                    <Circle
                      cx={RING_SIZE / 2}
                      cy={RING_SIZE / 2}
                      r={R}
                      fill="none"
                      stroke={theme.muted}
                      strokeWidth={STROKE}
                      opacity={0.35}
                    />
                    <Circle
                      cx={RING_SIZE / 2}
                      cy={RING_SIZE / 2}
                      r={R}
                      fill="none"
                      stroke={theme.tint}
                      strokeWidth={STROKE}
                      strokeDasharray={CIRC}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                    />
                  </Svg>
                  <Text style={[styles.countdownNum, { color: theme.text }]}>{Math.max(0, timeLeft)}</Text>
                </View>

                <VibelyButton
                  label={markingReady ? 'Marking...' : "I'm Ready"}
                  onPress={() => {
                    if (markingReady || terminalActionPending) return;
                    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                      sessionId,
                      platform: 'native',
                      eventId,
                      sourceSurface: 'ready_gate_overlay',
                      checkpoint: 'ready_tap',
                    });
                    trackEvent(
                      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                      buildReadyGateToDateLatencyPayload({
                        context: latencyContext,
                        checkpoint: 'ready_tap',
                        sourceAction: 'ready_tap',
                        outcome: 'success',
                      }),
                    );
                    trackEvent(LobbyPostDateEvents.READY_GATE_READY_TAP, {
                      platform: 'native',
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: 'ready_gate_overlay',
                      source_action: 'ready_tap',
                    });
                    trackEvent(LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY, {
                      platform: 'native',
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: 'ready_gate_overlay',
                      source_action: 'ready_tap',
                    });
                    setMarkingReady(true);
                    void (async () => {
                      try {
                        setTerminalActionError(null);
                        const result = await markReady();
                        if (!result.ok) throw new Error('ready_gate_mark_ready_failed');
                        startRoomWarmupAfterReady('ready_tap_mark_ready_success', result.status ?? null);
                      } catch (e) {
                        setTerminalActionError("We couldn't mark you ready. Check your connection and try again.");
                        rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_mark_ready_exception', {
                          message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
                        });
                        trackNativeReadyGateEvent(NativeReadyGateEvents.TRANSITION_FAILURE, {
                          action: 'mark_ready',
                          source_action: 'ready_tap',
                          reason: 'ready_gate_mark_ready_failed',
                          error_code: 'ready_gate_mark_ready_failed',
                          terminal: false,
                        });
                      } finally {
                        setMarkingReady(false);
                      }
                    })();
                  }}
                  variant="primary"
                  size="lg"
                  style={styles.readyBtn}
                  disabled={markingReady || requestingSnooze || terminalActionPending}
                />
                <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                  Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
                </Text>
                <View style={styles.secondaryRow}>
                  <Pressable
                    onPress={() => {
                      if (requestingSnooze || terminalActionPending) return;
                      trackEvent(LobbyPostDateEvents.READY_GATE_SNOOZE_TAP, {
                        platform: 'native',
                        session_id: sessionId,
                        event_id: eventId,
                      });
                      setRequestingSnooze(true);
                      void (async () => {
                        try {
                          setTerminalActionError(null);
                          const result = await snooze();
                          if (!result.ok) throw new Error('ready_gate_snooze_failed');
                        } catch (e) {
                          setTerminalActionError("We couldn't snooze this match. Check your connection and try again.");
                          rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_snooze_exception', {
                            message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
                          });
                          trackNativeReadyGateEvent(NativeReadyGateEvents.TRANSITION_FAILURE, {
                            action: 'snooze',
                            source_action: 'snooze_tap',
                            reason: 'ready_gate_snooze_failed',
                            error_code: 'ready_gate_snooze_failed',
                            terminal: false,
                          });
                        } finally {
                          setRequestingSnooze(false);
                        }
                      })();
                    }}
                    disabled={requestingSnooze || markingReady || terminalActionPending}
                    accessibilityRole="button"
                    accessibilityLabel="Snooze this Ready Gate for two minutes"
                    style={({ pressed }) => [
                      styles.skipWrap,
                      (requestingSnooze || markingReady || terminalActionPending) && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                      {requestingSnooze ? 'Snoozing...' : 'Snooze — give me 2 min'}
                    </Text>
                  </Pressable>
                  <Text style={[styles.dot, { color: theme.textSecondary }]}>·</Text>
                  <Pressable
                    onPress={() => { void handleSkip(); }}
                    disabled={requestingSnooze || markingReady || terminalActionPending}
                    accessibilityRole="button"
                    accessibilityLabel="Step away from this Ready Gate"
                    style={({ pressed }) => [
                      styles.skipWrap,
                      (requestingSnooze || markingReady || terminalActionPending) && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                      {terminalActionPending ? 'Leaving...' : 'Step away'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.waitingPill, { borderColor: withAlpha(theme.tint, 0.35), backgroundColor: theme.tintSoft }]}>
                  <Ionicons
                    name={readinessStatusIcon}
                    size={18}
                    color={theme.tint}
                  />
                  <Text style={[styles.waitingPillText, { color: theme.text }]}>
                    {readyGateReadinessCopy.text}
                  </Text>
                </View>
                <Pressable
                  onPress={() => { void handleSkip(); }}
                  disabled={requestingSnooze || markingReady || terminalActionPending}
                  accessibilityRole="button"
                  accessibilityLabel="Step away while waiting for your match"
                  style={({ pressed }) => [
                    styles.skipWrap,
                    (requestingSnooze || markingReady || terminalActionPending) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                    {terminalActionPending ? 'Leaving...' : 'Step away'}
                  </Text>
                </Pressable>
              </>
            )}
          </Card>
        )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  backdropContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    minHeight: 420,
    padding: spacing.xl + spacing.md,
    alignItems: 'center',
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  ringSvg: { position: 'absolute' },
  countdownNum: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  title: {
    ...typography.titleLG,
    marginBottom: spacing.xs,
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
    textAlign: 'center',
    flexShrink: 1,
  },
  permissionLoadingSub: {
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  partnerReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  partnerReadyText: { fontSize: 14, fontWeight: '600' },
  subtleLine: { fontSize: 14 },
  terminalError: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  avatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarNameScrim: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: spacing.sm,
  },
  avatarNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  readyBtn: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
    minHeight: 48,
  },
  helperText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  skipWrap: {
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  skipText: {
    fontSize: 13,
  },
  dot: { fontSize: 14 },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  waitingPillText: { fontSize: 14, fontWeight: '600' },
});
