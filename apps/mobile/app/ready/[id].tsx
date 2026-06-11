import { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useLocalSearchParams, usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useReadyGate } from '@/lib/readyGateApi';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import {
  GlassHeaderBar,
  Card,
  VibelyButton,
  ErrorState,
} from '@/components/ui';
import { ReadyGateDiagnosticChecklist } from '@/components/lobby/ReadyGateDiagnosticChecklist';
import { spacing, radius, typography } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { eventLobbyHref, tabsRootHref } from '@/lib/activeSessionRoutes';
import { navigateToDateSessionGuarded } from '@/lib/dateNavigationGuard';
import {
  clearDateEntryTransition,
  isVideoDateRouteOwned,
  markVideoDateRouteOwned,
} from '@/lib/dateEntryTransitionLatch';
import { ensureVideoDateStartableBeforeNavigation } from '@/lib/videoDateEntryStartable';
import {
  defaultNativeReadyGateMediaDiagnostics,
  defaultNativeReadyGatePermissionDiagnostics,
  inspectNativeReadyGateMediaDevices,
} from '@/lib/readyGateNativeMediaDiagnostics';
import {
  checkNativeCameraMicrophonePermissions,
  requestNativeCameraMicrophonePermissions,
} from '@/lib/nativeMediaPermissions';
import { fetchVideoSessionDateEntryTruthCoalesced } from '@/lib/videoDateApi';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
import { fetchVideoDateStartSnapshot } from '@/lib/videoDateStartSnapshot';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import { updateVideoDateEntryOwnerState } from '@clientShared/matching/videoDateEntryOwner';
import {
  destroyNativeVideoDateDailyPrewarm,
  preAuthNativeVideoDateDailyPrewarm,
  startNativeVideoDateDailyPrewarm,
} from '@/lib/videoDateDailyPrewarm';
import {
  markNativeVideoDateLaunchIntent,
  videoDateLaunchBreadcrumb,
} from '@/lib/videoDateLaunchTrace';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import { READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE } from '@shared/matching/videoSessionFlow';
import {
  getReadyGateCountdownFromServerClock,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from '@clientShared/matching/readyGateCountdown';
import { isReadyGatePrepareEntryNonRetryable } from '@clientShared/matching/readyGateTerminalRecovery';
import {
  adviseVideoDateSnapshotRecovery,
  adviseVideoSessionTruthRecovery,
  resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery,
} from '@clientShared/matching/videoDateRecoveryAdvisor';
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
} from '@clientShared/matching/videoDateRouteDecision';
import { getReadyGateReadinessStatusCopy } from '@clientShared/matching/readyGateReadiness';
import {
  resolveReadyGateDiagnosticChecklist,
  resolveReadyGatePrepareEntryFailureCopy,
  resolveReadyGateTransitionFailureCopy,
  type ReadyGateDiagnosticCopy,
} from '@clientShared/matching/readyGateDiagnosticCopy';
import {
  openPermissionSettings,
  useSettingsReturnRefresh,
} from '@/lib/permissionSettings';
import { fetchReadyGateSharedVibes } from '@/lib/readyGateSharedVibes';

const GATE_TIMEOUT_SEC = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const READY_GATE_TRUTH_RECONCILE_MS = 10_000;
const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;
const READY_GATE_SYNC_TIMEOUT_COOLDOWN_MS = 3_000;

function isReadyGateTransitionTimeoutSignal(input: {
  code?: string | null;
  errorCode?: string | null;
  reason?: string | null;
  error?: string | null;
  retryable?: boolean | null;
}): boolean {
  if (input.retryable === true) return true;
  const text = [input.code, input.errorCode, input.reason, input.error]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('57014') ||
    text.includes('statement timeout') ||
    text.includes('canceling statement') ||
    text.includes('cancelled on user request')
  );
}

function isReadyGateReadyProgressStatus(status?: string | null): boolean {
  return (
    status === 'ready' ||
    status === 'ready_a' ||
    status === 'ready_b' ||
    status === 'both_ready'
  );
}


export default function ReadyGateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const snapshotV2 = useFeatureFlag('video_date.snapshot_v2');
  const {
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    partnerName,
    snoozedByPartner,
    snoozeExpiresAt,
    expiresAt,
    markReady,
    forfeit,
    snooze,
    syncSession,
    isBothReady,
    isForfeited,
    isSnoozed,
    status,
    reason,
    inactiveReason,
    errorCode,
    terminal,
    serverNowMs,
    clientSyncedAtMs,
    phaseDeadlineAtMs,
    realtimeDegraded,
    sequenceGapUnresolved,
    retryBroadcastGapRecovery,
    readyGateClockEnabled,
  } = useReadyGate(sessionId ?? null, user?.id ?? null);

  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [snoozeTimeLeft, setSnoozeTimeLeft] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [sessionLookupDone, setSessionLookupDone] = useState(false);
  const [permissionRequestEligible, setPermissionRequestEligible] =
    useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(
    null,
  );
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(
    null,
  );
  const [sharedVibes, setSharedVibes] = useState<string[]>([]);
  const [prepareEntryFailureCode, setPrepareEntryFailureCode] = useState<
    string | null
  >(null);
  const [prepareEntryFailureRetryable, setPrepareEntryFailureRetryable] =
    useState(false);
  const [nativeMediaDiagnostics, setNativeMediaDiagnostics] = useState(
    defaultNativeReadyGateMediaDiagnostics,
  );
  const [nativePermissionDiagnostics, setNativePermissionDiagnostics] =
    useState(defaultNativeReadyGatePermissionDiagnostics);
  const invalidSessionLoggedRef = useRef(false);
  /** At most one explain-then-navigate dialog per mount / session id (stale vs invalid deep link). */
  const redirectExplainedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const terminalRecoveryKeyRef = useRef<string | null>(null);
  const nonRetryablePrepareBlockerRef = useRef<string | null>(null);
  const expirySyncInFlightRef = useRef(false);
  const expirySyncRetryAtMsRef = useRef(0);
  const readyGateOpenedAtMsRef = useRef(Date.now());
  const activeSessionIdRef = useRef<string | null>(
    sessionId ? String(sessionId) : null,
  );
  const readyActionInFlightRef = useRef(false);
  const guardedSyncInFlightRef = useRef(false);
  const guardedSyncCooldownUntilMsRef = useRef(0);
  const permissionSettingsOpenedRef = useRef(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const cancelTerminalReadyGateWork = useCallback(
    (cancelReason: string) => {
      readyActionInFlightRef.current = false;
      guardedSyncCooldownUntilMsRef.current = Number.POSITIVE_INFINITY;
      expirySyncInFlightRef.current = false;
      expirySyncRetryAtMsRef.current = Number.POSITIVE_INFINITY;
      const sid = sessionId ? String(sessionId) : null;
      if (!sid || !user?.id) return;
      destroyNativeVideoDateDailyPrewarm(sid, user.id, cancelReason);
    },
    [sessionId, user?.id],
  );

  const guardedSyncSession = useCallback(
    async (
      source: string,
      options: { allowWhileMarking?: boolean } = {},
    ) => {
      if (!options.allowWhileMarking && readyActionInFlightRef.current) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_sync_suppressed_mark_ready_in_flight', {
          session_id: sessionId,
          event_id: eventId,
          source,
        });
        return null;
      }
      const nowMs = Date.now();
      if (guardedSyncCooldownUntilMsRef.current > nowMs) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_sync_suppressed_cooldown', {
          session_id: sessionId,
          event_id: eventId,
          source,
          retry_at_ms: guardedSyncCooldownUntilMsRef.current,
        });
        return null;
      }
      if (guardedSyncInFlightRef.current) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_sync_coalesced', {
          session_id: sessionId,
          event_id: eventId,
          source,
        });
        return null;
      }
      guardedSyncInFlightRef.current = true;
      try {
        const result = await syncSession();
        if (result.ok === false && isReadyGateTransitionTimeoutSignal(result)) {
          guardedSyncCooldownUntilMsRef.current =
            Date.now() + READY_GATE_SYNC_TIMEOUT_COOLDOWN_MS;
        } else if (result?.ok === true) {
          guardedSyncCooldownUntilMsRef.current = 0;
        }
        return result;
      } finally {
        guardedSyncInFlightRef.current = false;
      }
    },
    [eventId, sessionId, syncSession],
  );

  const refreshNativeMediaDiagnostics = useCallback(
    async (permission: boolean | null = hasMediaPermission) => {
      const activeSessionId = activeSessionIdRef.current;
      setNativeMediaDiagnostics((current) => ({
        ...current,
        cameraDeviceStatus: permission
          ? 'checking'
          : current.cameraDeviceStatus,
        microphoneDeviceStatus: permission
          ? 'checking'
          : current.microphoneDeviceStatus,
      }));
      const next = await inspectNativeReadyGateMediaDevices(permission);
      if (activeSessionIdRef.current !== activeSessionId) return;
      setNativeMediaDiagnostics(next);
    },
    [hasMediaPermission],
  );

  const applyMediaPermissionResult = useCallback(
    (
      result: Awaited<
        ReturnType<typeof requestNativeCameraMicrophonePermissions>
      >,
    ) => {
      setHasMediaPermission(result.ok);
      setPermissionsResolved(true);
      setNativePermissionDiagnostics((current) => ({
        cameraPermissionStatus:
          !result.ok &&
          current.cameraPermissionStatus === 'blocked' &&
          result.cameraStatus !== 'granted'
            ? 'blocked'
            : result.permissions.cameraPermissionStatus,
        microphonePermissionStatus:
          !result.ok &&
          current.microphonePermissionStatus === 'blocked' &&
          result.microphoneStatus !== 'granted'
            ? 'blocked'
            : result.permissions.microphonePermissionStatus,
      }));
      void refreshNativeMediaDiagnostics(result.ok);
      return result.ok;
    },
    [refreshNativeMediaDiagnostics],
  );

  const checkMediaPermissions = useCallback(async (): Promise<boolean> => {
    const result = await checkNativeCameraMicrophonePermissions({
      sessionId: sessionId ? String(sessionId) : null,
      userId: user?.id ?? null,
      sources: {
        androidExisting: 'standalone_ready_android_existing_grants',
        androidRequest: 'standalone_ready_android_request',
        nativeExisting: 'standalone_ready_native_existing_grants',
        nativeRequest: 'standalone_ready_native_request',
      },
    });
    return applyMediaPermissionResult(result);
  }, [applyMediaPermissionResult, sessionId, user?.id]);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    const result = await requestNativeCameraMicrophonePermissions({
      sessionId: sessionId ? String(sessionId) : null,
      userId: user?.id ?? null,
      sources: {
        androidExisting: 'standalone_ready_android_existing_grants',
        androidRequest: 'standalone_ready_android_request',
        nativeExisting: 'standalone_ready_native_existing_grants',
        nativeRequest: 'standalone_ready_native_request',
      },
    });
    return applyMediaPermissionResult(result);
  }, [applyMediaPermissionResult, sessionId, user?.id]);

  useSettingsReturnRefresh({
    wasOpenedRef: permissionSettingsOpenedRef,
    refresh: checkMediaPermissions,
    source: 'ready_screen_media',
  });

  const openMediaPermissionSettings = useCallback(async () => {
    permissionSettingsOpenedRef.current = true;
    const opened = await openPermissionSettings('ready_screen_media');
    if (!opened) {
      permissionSettingsOpenedRef.current = false;
      void checkMediaPermissions();
    }
  }, [checkMediaPermissions]);

  useEffect(() => {
    activeSessionIdRef.current = sessionId ? String(sessionId) : null;
    readyActionInFlightRef.current = false;
  }, [sessionId]);

  const reconcileFromCanonicalTruth = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return false;
      const sid = String(sessionId);
      const [startable, regRes] = await Promise.all([
        ensureVideoDateStartableBeforeNavigation({
          sessionId: sid,
          source: `ready_standalone_${source}`,
          userId: user.id,
        }),
        supabase
          .from('event_registrations')
          .select('queue_status, current_room_id')
          .eq('profile_id', user.id)
          .eq('current_room_id', sid)
          .maybeSingle(),
      ]);
      const reg = regRes.data;
      const vs = startable.truth;
      const routedTo = startable.ok
        ? 'date'
        : startable.recommend === 'ready'
          ? 'ready'
          : startable.recommend === 'survey'
            ? 'survey'
            : startable.recommend === 'ended'
              ? 'ended'
              : 'lobby';
      rcBreadcrumb(RC_CATEGORY.readyGate, 'date_route_decision', {
        session_id: sid,
        user_id: user.id,
        startable_ok: startable.ok,
        startable_reason: startable.reason,
        routed_to: routedTo,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        handshake_started_at: Boolean(vs?.handshake_started_at),
        ready_gate_status: vs?.ready_gate_status ?? null,
        ready_gate_expires_at:
          vs?.ready_gate_expires_at == null
            ? null
            : String(vs.ready_gate_expires_at),
      });

      if (startable.ok) {
        if (dateNavigationStartedRef.current) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_duplicate_date_nav_suppressed',
            {
              session_id: sid,
              source,
              startable_reason: startable.reason,
            },
          );
          return true;
        }
        dateNavigationStartedRef.current = true;
        setPrepareEntryFailureCode(null);
        setPrepareEntryFailureRetryable(false);
        const prepared = await prepareVideoDateEntry(sid, {
          eventId: eventId ?? null,
          userId: user.id,
          source: `ready_standalone_${source}`,
        });
        if (prepared.ok !== true) {
          setPrepareEntryFailureCode(prepared.code);
          setPrepareEntryFailureRetryable(prepared.retryable);
          setTerminalActionError(null);
          const prepareRecoveryInput = {
            code: prepared.code,
            errorCode: prepared.code,
            httpStatus: prepared.httpStatus ?? null,
            reason: prepared.message ?? null,
            source: 'prepare_entry',
          };
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_prepare_entry_failed_date_owned',
            {
              session_id: sid,
              user_id: user.id,
              event_id: eventId,
              source,
              code: prepared.code,
              retryable: prepared.retryable,
            },
          );
          if (isReadyGatePrepareEntryNonRetryable(prepareRecoveryInput)) {
            const recovery = resolveReadyGateTerminalRecovery(prepareRecoveryInput);
            dateNavigationStartedRef.current = false;
            nonRetryablePrepareBlockerRef.current = `${sid}:${prepared.code}:prepare_entry`;
            clearDateEntryTransition(sid);
            cancelTerminalReadyGateWork(
              `ready_standalone_prepare_entry_nonretryable_${recovery.category}`,
            );
            setTransitioning(false);
            setTerminalActionError(recovery.body);
            return true;
          }
          setTransitioning(true);
          updateVideoDateEntryOwnerState({
            sessionId: sid,
            userId: user.id,
            state: 'navigating',
            source: 'ready_standalone_prepare_failed_date_owned',
            entryAttemptId: prepared.entryAttemptId ?? null,
            videoDateTraceId: prepared.entryAttemptId ?? null,
            failureCode: prepared.code,
            failureMessage: prepared.message ?? null,
          });
          markVideoDateRouteOwned(sid, user.id);
          const navigated = navigateToDateSessionGuarded({
            sessionId: sid,
            pathname,
            mode: 'replace',
            onSuppressed: ({ reason: suppressReason, target }) => {
              rcBreadcrumb(
                RC_CATEGORY.readyGate,
                'standalone_prepare_failed_date_nav_suppressed',
                {
                  session_id: sid,
                  reason: suppressReason,
                  target: String(target),
                  source,
                },
              );
            },
          });
          if (!navigated) {
            setTransitioning(false);
          }
          if (source === 'both_ready' && navigated) {
            videoDateLaunchBreadcrumb(
              'ready_standalone_prepare_failed_date_owned',
              {
                session_id: sid,
              },
            );
            markNativeVideoDateLaunchIntent(
              'ready_standalone_prepare_failed_date_owned',
            );
          }
          return true;
        }
        void startNativeVideoDateDailyPrewarm({
          sessionId: sid,
          userId: user.id,
          eventId: eventId ?? null,
          roomName: prepared.data.room_name,
          roomUrl: prepared.data.room_url,
          source: `ready_standalone_${source}`,
        })
          .then((prewarm) => {
            if (prewarm.ok) {
              // Pre-authenticate only — do NOT join Daily from the ready route. The
              // real join (which starts the backend handshake clock) is owned by
              // /date (useVideoCall.startCall) so the warm-up window starts there.
              void preAuthNativeVideoDateDailyPrewarm({
                sessionId: sid,
                userId: user.id,
                eventId: eventId ?? null,
                roomName: prepared.data.room_name,
                roomUrl: prepared.data.room_url,
                token: prepared.data.token,
                source: `ready_standalone_${source}`,
              });
            }
          })
          .catch((error) => {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_daily_prewarm_failed_before_date_nav',
              {
                session_id: sid,
                user_id: user.id,
                event_id: eventId,
                source,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          });
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_navigate_to_date', {
          session_id: sid,
          source,
          startable_reason: startable.reason,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs?.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
        });
        setTransitioning(true);
        updateVideoDateEntryOwnerState({
          sessionId: sid,
          userId: user.id,
          state: 'navigating',
          source: `ready_standalone_${source}`,
          roomName: prepared.data.room_name,
          entryAttemptId: prepared.data.entry_attempt_id ?? null,
          videoDateTraceId: prepared.data.video_date_trace_id ?? null,
        });
        markVideoDateRouteOwned(sid, user.id);
        const navigated = navigateToDateSessionGuarded({
          sessionId: sid,
          pathname,
          mode: 'replace',
          onSuppressed: ({ reason: suppressReason, target }) => {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_navigate_to_date_suppressed',
              {
                session_id: sid,
                reason: suppressReason,
                target: String(target),
                source,
              },
            );
          },
        });
        if (!navigated) {
          setTransitioning(false);
        }
        if (source === 'both_ready' && navigated) {
          videoDateLaunchBreadcrumb('ready_standalone_navigate_to_date', {
            session_id: sid,
          });
          markNativeVideoDateLaunchIntent('ready_standalone_both_ready');
        }
        return true;
      }

      // Not startable — caller stays on /ready unless we have a definitive non-ready route to take.
      if (startable.recommend === 'ready') {
        if (isVideoDateRouteOwned(sid, user.id)) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_ready_redirect_suppressed_by_date_route_ownership',
            {
              session_id: sid,
              source,
              startable_reason: startable.reason,
            },
          );
          markVideoDateRouteOwned(sid, user.id);
          navigateToDateSessionGuarded({
            sessionId: sid,
            pathname,
            mode: 'replace',
          });
          return true;
        }
        return false;
      }

      // Terminal / lobby fallback. Always clear latch so the new route cannot be suppressed by a
      // stale entry latch from a previous attempt.
      clearDateEntryTransition(sid);
      cancelTerminalReadyGateWork(`ready_standalone_terminal_${startable.reason}`);
      if (
        startable.reason === 'prepare_entry_event_inactive' ||
        isReadyGatePrepareEntryNonRetryable({
          code: startable.reason,
          errorCode: startable.reason,
          source: 'prepare_entry',
        })
      ) {
        nonRetryablePrepareBlockerRef.current = `${sid}:${startable.reason}`;
      }
      router.replace(startable.recommendHref);
      return true;
    },
    [cancelTerminalReadyGateWork, eventId, pathname, sessionId, user?.id],
  );

  useEffect(() => {
    if (sessionId && user?.id) return;
    if (invalidSessionLoggedRef.current) return;
    invalidSessionLoggedRef.current = true;
    rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_invalid_session', {
      has_session_id: Boolean(sessionId),
      has_user: Boolean(user?.id),
    });
  }, [sessionId, user?.id]);

  useEffect(() => {
    setSessionLookupDone(false);
    setPermissionRequestEligible(false);
    redirectExplainedRef.current = false;
    dateNavigationStartedRef.current = false;
    terminalRecoveryKeyRef.current = null;
    nonRetryablePrepareBlockerRef.current = null;
    guardedSyncCooldownUntilMsRef.current = 0;
    expirySyncInFlightRef.current = false;
    expirySyncRetryAtMsRef.current = 0;
    readyGateOpenedAtMsRef.current = Date.now();
    setTimeLeft(GATE_TIMEOUT_SEC);
    setPermissionsResolved(false);
    setHasMediaPermission(null);
    setTerminalActionPending(false);
    setTerminalActionError(null);
    setSharedVibes([]);
    setPrepareEntryFailureCode(null);
    setPrepareEntryFailureRetryable(false);
    setNativeMediaDiagnostics(defaultNativeReadyGateMediaDiagnostics());
    setNativePermissionDiagnostics(
      defaultNativeReadyGatePermissionDiagnostics(),
    );
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id || !permissionRequestEligible) return;
    if (permissionsResolved) return;
    let cancelled = false;
    void (async () => {
      const ok = await checkMediaPermissions();
      if (cancelled || ok) return;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_permissions_denied', {
        session_id: sessionId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    checkMediaPermissions,
    permissionRequestEligible,
    permissionsResolved,
    sessionId,
    user?.id,
  ]);

  useEffect(() => {
    if (!sessionId || !user?.id || !sessionLookupDone) return;
    const handleAppState = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void guardedSyncSession('app_foreground');
      void reconcileFromCanonicalTruth('app_foreground');
      void retryBroadcastGapRecovery('app_foreground');
    };
    handleAppState(AppState.currentState);
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [
    reconcileFromCanonicalTruth,
    retryBroadcastGapRecovery,
    sessionId,
    sessionLookupDone,
    guardedSyncSession,
    user?.id,
  ]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const explainInvalidToTabs = () => {
      if (redirectExplainedRef.current) return;
      redirectExplainedRef.current = true;
      showDialog({
        title: 'Link unavailable',
        message: READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
        variant: 'info',
        primaryAction: {
          label: 'Continue',
          onPress: () => router.replace(tabsRootHref()),
        },
      });
    };
    const load = async () => {
      let revealReadyUi = false;
      setPermissionRequestEligible(false);
      try {
        if (snapshotV2.enabled) {
          const snapshot = await fetchVideoDateSnapshot(String(sessionId), {
            includeToken: false,
          });
          const recovery = adviseVideoDateSnapshotRecovery(snapshot, {
            expectedSessionId: String(sessionId),
            platform: 'native',
            surface: 'ready_redirect',
          });
          if (snapshot.ok === true) {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_snapshot_v2_loaded',
              {
                session_id: sessionId,
                event_id: snapshot.eventId,
                phase: snapshot.phase,
                room_present: Boolean(snapshot.room?.url),
              },
            );
            if (recovery.action === 'go_date') {
              await reconcileFromCanonicalTruth(
                `initial_snapshot_${recovery.reason}`,
              );
              return;
            }
            if (recovery.action === 'go_survey') {
              setTransitioning(true);
              const navigated = navigateToDateSessionGuarded({
                sessionId: recovery.sessionId,
                pathname,
                mode: 'replace',
                force: true,
                onSuppressed: ({ reason: suppressReason, target }) => {
                  rcBreadcrumb(
                    RC_CATEGORY.readyGate,
                    'standalone_snapshot_survey_nav_suppressed',
                    {
                      session_id: recovery.sessionId,
                      reason: suppressReason,
                      target: String(target),
                    },
                  );
                },
              });
              if (!navigated) {
                setTransitioning(false);
                revealReadyUi = true;
                const recovered = await reconcileFromCanonicalTruth(
                  `initial_snapshot_${recovery.reason}_nav_suppressed`,
                );
                if (recovered) return;
              }
              if (navigated) return;
            }
            if (
              recovery.action === 'go_home' &&
              recovery.reason === 'missing_event'
            ) {
              explainInvalidToTabs();
              return;
            }
            if (
              recovery.action === 'go_lobby' &&
              recovery.reason !== 'not_date_ready'
            ) {
              router.replace(eventLobbyHref(recovery.eventId));
              return;
            }
            if (
              recovery.action === 'go_lobby' &&
              recovery.reason === 'not_date_ready'
            ) {
              rcBreadcrumb(
                RC_CATEGORY.readyGate,
                'standalone_snapshot_lobby_deferred_to_truth',
                {
                  session_id: sessionId,
                  event_id: recovery.eventId,
                  phase: snapshot.phase,
                },
              );
            }
          } else if (recovery.action === 'invalid') {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_snapshot_v2_rejected',
              {
                session_id: sessionId,
                error: recovery.reason,
              },
            );
            explainInvalidToTabs();
            return;
          }
        }

        const startSnapshot = await fetchVideoDateStartSnapshot(String(sessionId));
        const session = startSnapshot.raw as {
          participant_1_id?: string | null;
          participant_2_id?: string | null;
          event_id?: string | null;
          ended_at?: string | null;
        };

        if (!startSnapshot.ok || !startSnapshot.eventId) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_session_row_missing',
            {
              session_id: sessionId,
              snapshot_error: startSnapshot.error,
            },
          );
          explainInvalidToTabs();
          return;
        }

        const isParticipant =
          session.participant_1_id === user.id ||
          session.participant_2_id === user.id;
        if (!isParticipant) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_not_participant', {
            session_id: sessionId,
          });
          explainInvalidToTabs();
          return;
        }

        if (session.ended_at) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_session_ended', {
            session_id: sessionId,
          });
          cancelTerminalReadyGateWork('ready_standalone_initial_session_ended');
          await reconcileFromCanonicalTruth('initial_session_ended');
          return;
        }

        const initialTruth = await fetchVideoSessionDateEntryTruthCoalesced(
          String(sessionId),
        );
        const initialCanonicalRoute = decideCanonicalVideoDateRoute({
          sessionId: String(sessionId),
          eventId: startSnapshot.eventId,
          truth: initialTruth,
        });
        const initialCanonicalLog = canonicalVideoDateRouteLogDetail(
          initialCanonicalRoute,
          {
            sourceSurface: 'ready_redirect',
            sourceAction: 'standalone_initial_truth',
          },
        );
        const initialRecovery = adviseVideoSessionTruthRecovery({
          sessionId: String(sessionId),
          eventId: startSnapshot.eventId,
          truth: initialTruth,
          platform: 'native',
          surface: 'ready_redirect',
        });
        const initialDecision = initialRecovery.routeDecision;
        if (initialRecovery.action !== 'go_ready_gate') {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_initial_truth_canonical_recheck',
            {
              session_id: sessionId,
              event_id: startSnapshot.eventId,
              ...initialCanonicalLog,
            },
          );
          if (initialRecovery.action === 'go_date') {
            revealReadyUi = true;
          }
          await reconcileFromCanonicalTruth(`initial_truth_${initialDecision}`);
          return;
        }

        const { data: reg } = await supabase
          .from('event_registrations')
          .select('queue_status')
          .eq('event_id', startSnapshot.eventId)
          .eq('profile_id', user.id)
          .maybeSingle();

        if (reg?.queue_status !== 'in_ready_gate') {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_not_in_ready_gate', {
            session_id: sessionId,
            queue_status: reg?.queue_status ?? null,
            canonical_decision: initialDecision,
            ...initialCanonicalLog,
          });
        }

        setEventId(startSnapshot.eventId);
        setPermissionRequestEligible(true);
        revealReadyUi = true;
        const partnerId = startSnapshot.partnerId;
        if (!partnerId) return;
        let profile: unknown = null;
        try {
          const { data, error: profileError } = await supabase.rpc(
            'get_profile_for_viewer',
            {
              p_target_id: partnerId,
            },
          );
          if (profileError) {
            rcBreadcrumb(
              RC_CATEGORY.readyGate,
              'standalone_partner_profile_display_degraded',
              {
                session_id: sessionId,
                event_id: startSnapshot.eventId,
                error: profileError.message.slice(0, 120),
              },
            );
          } else {
            profile = data;
          }
        } catch (error) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_partner_profile_display_degraded',
            {
              session_id: sessionId,
              event_id: startSnapshot.eventId,
              error:
                error instanceof Error
                  ? error.message.slice(0, 120)
                  : String(error).slice(0, 120),
            },
          );
        }
        const partnerProfile = profile as {
          avatar_url?: unknown;
          photos?: unknown;
        } | null;
        if (partnerProfile) {
          const photo = resolvePrimaryProfilePhotoPath({
            photos: partnerProfile.photos,
            avatar_url: partnerProfile.avatar_url,
          });
          setPartnerAvatar(photo);
        }
      } finally {
        if (revealReadyUi) setSessionLookupDone(true);
      }
    };
    void load();
  }, [
    cancelTerminalReadyGateWork,
    pathname,
    reconcileFromCanonicalTruth,
    sessionId,
    showDialog,
    snapshotV2.enabled,
    user?.id,
  ]);

  useEffect(() => {
    if (!sessionLookupDone || !sessionId || !user?.id) {
      setSharedVibes([]);
      return;
    }

    let cancelled = false;
    setSharedVibes([]);
    void fetchReadyGateSharedVibes({
      sessionId: String(sessionId),
      userId: user.id,
    })
      .then((labels) => {
        if (!cancelled) setSharedVibes(labels);
      })
      .catch(() => {
        if (!cancelled) setSharedVibes([]);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionLookupDone, user?.id]);

  useEffect(() => {
    if (isBothReady && sessionId) {
      rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_seen', {
        session_id: sessionId,
      });
    }
  }, [isBothReady, sessionId]);

  useEffect(() => {
    if (!isBothReady) return;
    setTransitioning(true);
    void reconcileFromCanonicalTruth('both_ready');
  }, [isBothReady, reconcileFromCanonicalTruth]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    if (!iAmReady || isBothReady || transitioning || isForfeited) return;

    const timer = setTimeout(() => {
      void reconcileFromCanonicalTruth('ready_wait_threshold');
    }, READY_GATE_TRUTH_RECONCILE_MS);

    return () => clearTimeout(timer);
  }, [
    iAmReady,
    isBothReady,
    isForfeited,
    reconcileFromCanonicalTruth,
    sessionId,
    transitioning,
    user?.id,
  ]);

  useEffect(() => {
    if (isForfeited) {
      setTerminalActionPending(false);
      setTerminalActionError(null);
      const recoveryInput = {
        status,
        reason,
        inactiveReason,
        errorCode,
        terminal: terminal ?? true,
        source: 'ready_standalone_terminal',
      };
      const recovery = resolveReadyGateTerminalRecovery(recoveryInput);
      const terminalKey = `${sessionId ?? 'none'}:${recovery.category}:${reason ?? errorCode ?? status}`;
      if (terminalRecoveryKeyRef.current === terminalKey) return;
      terminalRecoveryKeyRef.current = terminalKey;
      cancelTerminalReadyGateWork(
        `ready_standalone_forfeited_${recovery.category}`,
      );
      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_forfeited', {
        session_id: sessionId ?? null,
        event_id: eventId,
        terminal_category: recovery.category,
        reason: reason ?? null,
        error_code: errorCode ?? null,
        inactive_reason: inactiveReason ?? null,
      });
      showDialog({
        title: recovery.title,
        message: recovery.body,
        variant: 'info',
        primaryAction: {
          label: eventId ? 'Back to lobby' : 'Continue',
          onPress: () => {
            if (eventId) router.replace(eventLobbyHref(eventId));
            else router.replace(tabsRootHref());
          },
        },
      });
    }
  }, [
    errorCode,
    eventId,
    inactiveReason,
    isForfeited,
    cancelTerminalReadyGateWork,
    reason,
    sessionId,
    showDialog,
    status,
    terminal,
  ]);

  useEffect(() => {
    if (iAmReady) {
      readyActionInFlightRef.current = false;
      setMarkingReady(false);
    }
  }, [iAmReady]);

  useEffect(() => {
    if (isSnoozed) setRequestingSnooze(false);
  }, [isSnoozed]);

  const runReadyGateForfeit = useCallback(
    async (reason: 'skip') => {
      if (terminalActionPending) return;
      setTerminalActionPending(true);
      setTerminalActionError(null);
      let transitionFailure: ReturnType<
        typeof resolveReadyGateTransitionFailureCopy
      > | null = null;
      try {
        const result = await forfeit();
        if (result.ok === false) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason,
            error: result.error,
            status: result.status,
            platform: 'native',
          });
          throw new Error(transitionFailure.message);
        }
        if (result.status === 'both_ready') {
          setTerminalActionPending(false);
          setTerminalActionError(null);
          return;
        }
        const terminal =
          result.terminal === true ||
          result.isTerminal === true ||
          result.status === 'forfeited' ||
          result.status === 'expired' ||
          result.status === 'cancelled' ||
          result.status === 'ended';
        if (!terminal) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason ?? 'ready_gate_forfeit_not_terminal',
            status: result.status,
            platform: 'native',
          });
          throw new Error(transitionFailure.message);
        }
        setTerminalActionPending(false);
        setTerminalActionError(null);
        if (eventId) router.replace(eventLobbyHref(eventId));
        else if (sessionLookupDone) router.replace(tabsRootHref());
        cancelTerminalReadyGateWork('ready_standalone_forfeit_terminal');
      } catch (e) {
        const fallback =
          transitionFailure ??
          resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            error: e instanceof Error ? e.message : String(e),
            platform: 'native',
          });
        setTerminalActionError(fallback.message);
        setTerminalActionPending(false);
        rcBreadcrumb(
          RC_CATEGORY.readyGate,
          'standalone_forfeit_failed_kept_open',
          {
            session_id: sessionId ?? null,
            event_id: eventId,
            reason,
            reason_code: fallback.reasonCode,
            error_code: fallback.code ?? fallback.reasonCode,
            multi_device_conflict: fallback.staleOrConflict,
            message_snippet:
              e instanceof Error ? e.message.slice(0, 120) : 'unknown',
          },
        );
      }
    },
    [
      cancelTerminalReadyGateWork,
      eventId,
      forfeit,
      sessionId,
      sessionLookupDone,
      terminalActionPending,
    ],
  );

  const syncExpiredReadyGate = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return;
      const now = Date.now();
      if (expirySyncInFlightRef.current || expirySyncRetryAtMsRef.current > now)
        return;

      expirySyncInFlightRef.current = true;
      expirySyncRetryAtMsRef.current = now + EXPIRY_SYNC_RETRY_DELAY_MS;
      try {
        const result = await guardedSyncSession(source);
        if (result?.ok === true && result.expiresAt) {
          setTimeLeft(
            getReadyGateCountdownFromServerClock({
              expiresAt: readyGateClockEnabled
                ? (phaseDeadlineAtMs ?? result.expiresAt)
                : result.expiresAt,
              serverNowMs: readyGateClockEnabled ? serverNowMs : null,
              clientSyncedAtMs: readyGateClockEnabled ? clientSyncedAtMs : null,
              fallbackDeadlineMs:
                readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
              fallbackSeconds: GATE_TIMEOUT_SEC,
            }).remainingSeconds,
          );
          return;
        }
        if (result?.ok === false) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_countdown_expiry_sync_deferred',
            {
              session_id: sessionId,
              source,
              error: result.error,
            },
          );
        }
      } finally {
        expirySyncInFlightRef.current = false;
      }
    },
    [
      clientSyncedAtMs,
      phaseDeadlineAtMs,
      readyGateClockEnabled,
      serverNowMs,
      sessionId,
      guardedSyncSession,
      user?.id,
    ],
  );

  useEffect(() => {
    if (
      transitioning ||
      iAmReady ||
      markingReady ||
      requestingSnooze ||
      terminalActionPending
    )
      return;
    if (isSnoozed && snoozeExpiresAt) {
      const remaining = Math.max(
        0,
        Math.floor((new Date(snoozeExpiresAt).getTime() - Date.now()) / 1000),
      );
      setSnoozeTimeLeft(remaining);
      return;
    }
    const t = setInterval(() => {
      setTimeLeft(() => {
        const next = getReadyGateCountdownFromServerClock({
          expiresAt: readyGateClockEnabled
            ? (phaseDeadlineAtMs ?? expiresAt)
            : expiresAt,
          serverNowMs: readyGateClockEnabled ? serverNowMs : null,
          clientSyncedAtMs: readyGateClockEnabled ? clientSyncedAtMs : null,
          fallbackDeadlineMs:
            readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
          fallbackSeconds: GATE_TIMEOUT_SEC,
        }).remainingSeconds;
        if (next <= 0) {
          void syncExpiredReadyGate('countdown_expired');
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [
    transitioning,
    iAmReady,
    markingReady,
    requestingSnooze,
    terminalActionPending,
    isSnoozed,
    snoozeExpiresAt,
    expiresAt,
    serverNowMs,
    clientSyncedAtMs,
    phaseDeadlineAtMs,
    readyGateClockEnabled,
    syncExpiredReadyGate,
  ]);

  useEffect(() => {
    if (!isSnoozed || terminalActionPending) return;
    const t = setInterval(() => {
      setSnoozeTimeLeft((prev) => {
        if (prev <= 1) {
          void syncExpiredReadyGate('snooze_expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isSnoozed, terminalActionPending, syncExpiredReadyGate]);

  const handleSkip = () => {
    if (terminalActionPending) return;
    showDialog({
      title: 'Step away from this match?',
      message:
        "You'll return to the lobby. Your match can keep going with others.",
      variant: 'destructive',
      primaryAction: {
        label: 'Step away',
        onPress: () => {
          void runReadyGateForfeit('skip');
        },
      },
      secondaryAction: { label: 'Stay', onPress: () => {} },
    });
  };

  if (!sessionId || !user?.id) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {dialogEl}
        <ErrorState
          title="Invalid session"
          message="This ready gate link may have expired or isn't valid."
          actionLabel="Go back"
          onActionPress={() => router.replace(tabsRootHref())}
        />
      </View>
    );
  }

  if (!sessionLookupDone) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {dialogEl}
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.loadingHint, { color: theme.textSecondary }]}>
          Opening Ready Gate…
        </Text>
      </View>
    );
  }

  const readyGateReadinessCopy = getReadyGateReadinessStatusCopy({
    iAmReady,
    partnerReady,
    partnerReadyKnown,
    isBothReady,
    markingReady,
    partnerName: partnerName ?? 'Your match',
  });
  const showConnectingReadinessCopy =
    readyGateReadinessCopy.key === 'both_ready_connecting';
  const showReadyActionControls = !iAmReady && !showConnectingReadinessCopy;
  const readinessStatusIcon = showConnectingReadinessCopy
    ? 'sparkles'
    : readyGateReadinessCopy.key === 'syncing'
      ? 'time-outline'
      : 'checkmark-circle';
  const statusLine = isSnoozed
    ? `${partnerName ?? 'Partner'} needs a moment — back in ${Math.floor(snoozeTimeLeft / 60)}:${String(snoozeTimeLeft % 60).padStart(2, '0')}`
    : readyGateReadinessCopy.key === 'waiting_both'
      ? `Ready check ends in ${timeLeft}s`
      : readyGateReadinessCopy.text;
  const diagnosticChecklist = resolveReadyGateDiagnosticChecklist({
    platform: 'native',
    partnerName: partnerName ?? 'Your match',
    cameraPermissionStatus: permissionsResolved
      ? nativePermissionDiagnostics.cameraPermissionStatus
      : 'checking',
    microphonePermissionStatus: permissionsResolved
      ? nativePermissionDiagnostics.microphonePermissionStatus
      : 'checking',
    cameraDeviceStatus: nativeMediaDiagnostics.cameraDeviceStatus,
    microphoneDeviceStatus: nativeMediaDiagnostics.microphoneDeviceStatus,
    videoProviderStatus: prepareEntryFailureCode
      ? 'failed'
      : transitioning || isBothReady
        ? 'checking'
        : 'waiting',
    realtimeSyncStatus:
      realtimeDegraded || sequenceGapUnresolved ? 'warning' : 'ok',
    partnerReadinessStatus:
      isBothReady || partnerReady ? 'ok' : iAmReady ? 'warning' : 'checking',
  });
  const mediaPermissionNeedsSettings =
    nativePermissionDiagnostics.cameraPermissionStatus === 'blocked' ||
    nativePermissionDiagnostics.microphonePermissionStatus === 'blocked';
  const mediaPermissionPrimaryLabel = mediaPermissionNeedsSettings
    ? 'Open Settings'
    : 'Allow camera & mic';
  const handleMediaPermissionPrimaryAction = () => {
    if (mediaPermissionNeedsSettings) {
      void openMediaPermissionSettings();
      return;
    }
    void requestMediaPermissions();
  };
  const handleDiagnosticAction = (row: ReadyGateDiagnosticCopy) => {
    if (terminalActionPending) return;
    switch (row.actionKind) {
      case 'open_settings':
        void openMediaPermissionSettings();
        return;
      case 'request_permission':
        void requestMediaPermissions();
        return;
      case 'retry':
        if (row.key === 'video_provider' && prepareEntryFailureRetryable) {
          void reconcileFromCanonicalTruth('diagnostic_retry');
          return;
        }
        void refreshNativeMediaDiagnostics();
        return;
      case 'check_connection':
        void guardedSyncSession('diagnostic_retry');
        void retryBroadcastGapRecovery('diagnostic_retry');
        void reconcileFromCanonicalTruth('diagnostic_retry');
        return;
      case 'none':
      case 'wait':
        return;
    }
  };

  if (permissionsResolved && hasMediaPermission === false) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {dialogEl}
        <Ionicons
          name="videocam-off-outline"
          size={34}
          color={theme.textSecondary}
        />
        <Text
          style={[
            styles.transitioningTitle,
            { color: theme.text, marginTop: spacing.md },
          ]}
        >
          Camera and mic required
        </Text>
        <Text style={[styles.transitioningSub, { color: theme.textSecondary }]}>
          Allow camera and microphone access to join this date.
        </Text>
        <ReadyGateDiagnosticChecklist
          rows={diagnosticChecklist.rows}
          theme={theme}
          actionDisabled={terminalActionPending}
          onAction={handleDiagnosticAction}
        />
        <VibelyButton
          label={mediaPermissionPrimaryLabel}
          onPress={handleMediaPermissionPrimaryAction}
          variant="primary"
          size="lg"
        />
        <Pressable
          onPress={() => {
            if (eventId) router.replace(eventLobbyHref(eventId));
            else router.replace(tabsRootHref());
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to lobby"
          style={styles.ghostBtn}
        >
          <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>
            Back to lobby
          </Text>
        </Pressable>
      </View>
    );
  }

  if (transitioning) {
    return (
      <View
        style={[
          styles.transitioningWrap,
          { backgroundColor: theme.background },
        ]}
      >
        {dialogEl}
        <View
          style={[
            styles.transitioningIconWrap,
            { backgroundColor: theme.tintSoft },
          ]}
        >
          <Ionicons name="sparkles" size={40} color={theme.tint} />
        </View>
        <Text style={[styles.transitioningTitle, { color: theme.text }]}>
          Joining your date...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Back to lobby"
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text
          style={[styles.headerTitle, { color: theme.text }]}
          numberOfLines={1}
        >
          Ready to vibe?
        </Text>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card
          variant="glass"
          style={[styles.card, { borderColor: theme.glassBorder }]}
        >
          <Text style={[styles.partnerLabel, { color: theme.textSecondary }]}>
            Your match
          </Text>
          <View
            style={[
              styles.avatarWrap,
              {
                backgroundColor: theme.surfaceSubtle,
                borderColor: withAlpha(theme.tint, 0.25),
              },
            ]}
          >
            {partnerAvatar ? (
              <Image
                source={{ uri: avatarUrl(partnerAvatar) }}
                style={styles.avatarImg}
              />
            ) : (
              <Ionicons name="person" size={48} color={theme.textSecondary} />
            )}
          </View>
          <Text
            style={[styles.partnerName, { color: theme.text }]}
            numberOfLines={2}
          >
            {partnerName ?? 'Your match'}
          </Text>

          {sharedVibes.length > 0 ? (
            <View
              style={styles.sharedVibesWrap}
              accessibilityLabel="Shared vibes"
            >
              {sharedVibes.map((vibe) => (
                <View
                  key={vibe}
                  style={[
                    styles.sharedVibeChip,
                    {
                      borderColor: withAlpha(theme.tint, 0.28),
                      backgroundColor: withAlpha(theme.tint, 0.12),
                    },
                  ]}
                >
                  <Text
                    style={[styles.sharedVibeText, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {vibe}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View
            style={[
              styles.statusPill,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={theme.textSecondary}
            />
            <Text style={[styles.statusText, { color: theme.text }]}>
              {statusLine}
            </Text>
          </View>

          {partnerReady && !iAmReady && (
            <View
              style={[
                styles.readyCue,
                {
                  backgroundColor: theme.successSoft ?? theme.tintSoft,
                  borderColor: theme.success ?? withAlpha(theme.tint, 0.31),
                },
              ]}
            >
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={theme.success || theme.tint}
              />
              <Text style={[styles.readyCueText, { color: theme.text }]}>
                {partnerName ?? 'Partner'} is ready and waiting!
              </Text>
            </View>
          )}

          {snoozedByPartner && (
            <View
              style={[
                styles.snoozeCue,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={20}
                color={theme.textSecondary}
              />
              <Text
                style={[styles.snoozeCueText, { color: theme.textSecondary }]}
              >
                {partnerName ?? 'Partner'} needs a moment — they'll be right
                back!
              </Text>
            </View>
          )}

          {terminalActionError ? (
            <Text style={[styles.actionError, { color: theme.danger }]}>
              {terminalActionError}
            </Text>
          ) : null}

          <ReadyGateDiagnosticChecklist
            rows={diagnosticChecklist.rows}
            theme={theme}
            actionDisabled={terminalActionPending}
            onAction={handleDiagnosticAction}
          />
        </Card>

        <View style={styles.actions}>
          {showReadyActionControls ? (
            <>
              <VibelyButton
                label={markingReady ? 'Marking...' : "I'm Ready"}
                onPress={() => {
                  if (
                    readyActionInFlightRef.current ||
                    markingReady ||
                    requestingSnooze ||
                    terminalActionPending
                  ) {
                    return;
                  }
                  readyActionInFlightRef.current = true;
                  setMarkingReady(true);
                  void (async () => {
                    let transitionFailure: ReturnType<
                      typeof resolveReadyGateTransitionFailureCopy
                    > | null = null;
                    try {
                      setTerminalActionError(null);
                      const permissionReady = await requestMediaPermissions();
                      if (!permissionReady) {
                        setTerminalActionError(
                          'Allow camera and microphone access to join this date.',
                        );
                        rcBreadcrumb(
                          RC_CATEGORY.readyGate,
                          'standalone_mark_ready_blocked_permission',
                          {
                            session_id: sessionId,
                            event_id: eventId,
                          },
                        );
                        return;
                      }
                      const result = await markReady();
                      if (result.ok === false) {
                        if (isReadyGateTransitionTimeoutSignal(result)) {
                          const syncResult = await guardedSyncSession(
                            'mark_ready_timeout_recovery',
                            { allowWhileMarking: true },
                          );
                          if (
                            syncResult?.ok === true &&
                            isReadyGateReadyProgressStatus(syncResult.status)
                          ) {
                            setTerminalActionError(null);
                            if (syncResult.status === 'both_ready') {
                              setTransitioning(true);
                              await reconcileFromCanonicalTruth(
                                'mark_ready_timeout_sync_both_ready',
                              );
                            }
                            return;
                          }
                        }
                        transitionFailure =
                          resolveReadyGateTransitionFailureCopy({
                            action: 'mark_ready',
                            code: result.code,
                            errorCode: result.errorCode,
                            reason: result.reason,
                            error: result.error,
                            status: result.status,
                            retryable: result.retryable,
                            platform: 'native',
                          });
                        throw new Error(transitionFailure.message);
                      }
                      if (result.isTerminal === true) {
                        setTerminalActionError(null);
                        return;
                      }
                      if (result.status === 'both_ready') {
                        setTransitioning(true);
                        await reconcileFromCanonicalTruth(
                          'mark_ready_rpc_both_ready',
                        );
                      }
                    } catch (e) {
                      const fallback =
                        transitionFailure ??
                        resolveReadyGateTransitionFailureCopy({
                          action: 'mark_ready',
                          error: e instanceof Error ? e.message : String(e),
                          platform: 'native',
                        });
                      setTerminalActionError(fallback.message);
                      rcBreadcrumb(
                        RC_CATEGORY.readyGate,
                        'standalone_mark_ready_failed_kept_open',
                        {
                          session_id: sessionId,
                          event_id: eventId,
                          reason_code: fallback.reasonCode,
                          error_code: fallback.code ?? fallback.reasonCode,
                          multi_device_conflict: fallback.staleOrConflict,
                          message_snippet:
                            e instanceof Error
                              ? e.message.slice(0, 120)
                              : 'unknown',
                        },
                      );
                    } finally {
                      readyActionInFlightRef.current = false;
                      setMarkingReady(false);
                    }
                  })();
                }}
                variant="primary"
                size="lg"
                style={styles.primaryBtn}
                disabled={
                  markingReady || requestingSnooze || terminalActionPending
                }
              />
              <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                Snooze gives you up to 2 extra minutes. Step away exits this
                match attempt.
              </Text>
              <View style={styles.secondaryRow}>
                <Pressable
                  onPress={() => {
                    if (
                      requestingSnooze ||
                      markingReady ||
                      terminalActionPending
                    )
                      return;
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
                              action: 'snooze',
                              code: result.code,
                              errorCode: result.errorCode,
                              reason: result.reason,
                              error: result.error,
                              status: result.status,
                              platform: 'native',
                            });
                          throw new Error(transitionFailure.message);
                        }
                      } catch (e) {
                        const fallback =
                          transitionFailure ??
                          resolveReadyGateTransitionFailureCopy({
                            action: 'snooze',
                            error: e instanceof Error ? e.message : String(e),
                            platform: 'native',
                          });
                        setTerminalActionError(fallback.message);
                        rcBreadcrumb(
                          RC_CATEGORY.readyGate,
                          'standalone_snooze_failed_kept_open',
                          {
                            session_id: sessionId,
                            event_id: eventId,
                            reason_code: fallback.reasonCode,
                            error_code: fallback.code ?? fallback.reasonCode,
                            multi_device_conflict: fallback.staleOrConflict,
                            message_snippet:
                              e instanceof Error
                                ? e.message.slice(0, 120)
                                : 'unknown',
                          },
                        );
                      } finally {
                        setRequestingSnooze(false);
                      }
                    })();
                  }}
                  disabled={
                    requestingSnooze || markingReady || terminalActionPending
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Snooze this Ready Gate for two minutes"
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze ||
                      markingReady ||
                      terminalActionPending) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text
                    style={[
                      styles.ghostBtnText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {requestingSnooze
                      ? 'Snoozing...'
                      : 'Snooze — give me 2 min'}
                  </Text>
                </Pressable>
                <Text style={[styles.dot, { color: theme.textSecondary }]}>
                  ·
                </Text>
                <Pressable
                  onPress={handleSkip}
                  disabled={
                    requestingSnooze || markingReady || terminalActionPending
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Step away from this Ready Gate"
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze ||
                      markingReady ||
                      terminalActionPending) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text
                    style={[
                      styles.ghostBtnText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {terminalActionPending ? 'Leaving...' : 'Step away'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View
                style={[
                  styles.waitingPill,
                  {
                    backgroundColor: theme.tintSoft,
                    borderColor: withAlpha(theme.tint, 0.31),
                  },
                ]}
              >
                <Ionicons
                  name={readinessStatusIcon}
                  size={22}
                  color={theme.tint}
                />
                <Text style={[styles.waitingText, { color: theme.text }]}>
                  {readyGateReadinessCopy.text}
                </Text>
              </View>
              <Pressable
                onPress={handleSkip}
                disabled={terminalActionPending}
                accessibilityRole="button"
                accessibilityLabel="Step away while waiting for your match"
                style={({ pressed }) => [
                  styles.ghostBtn,
                  terminalActionPending && { opacity: 0.5 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  style={[styles.ghostBtnText, { color: theme.textSecondary }]}
                >
                  {terminalActionPending ? 'Leaving...' : 'Step away'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingHint: { marginTop: spacing.md, fontSize: 15, textAlign: 'center' },
  headerBar: { marginBottom: 0 },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.xl },
  partnerLabel: {
    fontSize: 12,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  avatarWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarImg: { width: '100%', height: '100%' },
  partnerName: {
    ...typography.titleLG,
    marginBottom: spacing.md,
    textAlign: 'center',
    flexShrink: 1,
  },
  sharedVibesWrap: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.lg,
  },
  sharedVibeChip: {
    maxWidth: '45%',
    minHeight: 26,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedVibeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  statusText: { fontSize: 14 },
  readyCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  readyCueText: { fontSize: 14, fontWeight: '600' },
  snoozeCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  snoozeCueText: { fontSize: 14 },
  actionError: { fontSize: 13, textAlign: 'center', marginTop: spacing.md },
  actions: { alignItems: 'center', gap: spacing.lg },
  primaryBtn: { alignSelf: 'stretch', minHeight: 48 },
  helperText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ghostBtn: {
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 13 },
  dot: { fontSize: 14 },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  waitingText: { fontSize: 15, fontWeight: '600' },
  transitioningWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  transitioningIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  transitioningTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  transitioningSub: { fontSize: 14 },
});
