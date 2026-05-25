import { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Image, ScrollView, ActivityIndicator, PermissionsAndroid, Platform, AppState, Linking, type AppStateStatus } from 'react-native';
import { useLocalSearchParams, usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { useAuth } from '@/context/AuthContext';
import { useReadyGate } from '@/lib/readyGateApi';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton, ErrorState } from '@/components/ui';
import { ReadyGateDiagnosticChecklist } from '@/components/lobby/ReadyGateDiagnosticChecklist';
import { spacing, radius, typography } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { eventLobbyHref, tabsRootHref } from '@/lib/activeSessionRoutes';
import { navigateToDateSessionGuarded } from '@/lib/dateNavigationGuard';
import { clearDateEntryTransition } from '@/lib/dateEntryTransitionLatch';
import { ensureVideoDateStartableBeforeNavigation } from '@/lib/videoDateEntryStartable';
import {
  defaultNativeReadyGateMediaDiagnostics,
  defaultNativeReadyGatePermissionDiagnostics,
  inspectNativeReadyGateMediaDevices,
  type NativeReadyGatePermissionDiagnosticState,
} from '@/lib/readyGateNativeMediaDiagnostics';
import { fetchVideoSessionDateEntryTruthCoalesced } from '@/lib/videoDateApi';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import {
  joinNativeVideoDateDailyPrewarm,
  preAuthNativeVideoDateDailyPrewarm,
  startNativeVideoDateDailyPrewarm,
} from '@/lib/videoDateDailyPrewarm';
import { markNativeVideoDateLaunchIntent, videoDateLaunchBreadcrumb } from '@/lib/videoDateLaunchTrace';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import {
  READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
} from '@shared/matching/videoSessionFlow';
import {
  getReadyGateCountdownFromServerClock,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from '@clientShared/matching/readyGateCountdown';
import {
  isReadyGatePrepareEntryNonRetryable,
} from '@clientShared/matching/readyGateTerminalRecovery';
import {
  adviseVideoDateSnapshotRecovery,
  adviseVideoSessionTruthRecovery,
  resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery,
} from '@clientShared/matching/videoDateRecoveryAdvisor';
import { getReadyGateReadinessStatusCopy } from '@clientShared/matching/readyGateReadiness';
import {
  resolveReadyGateDiagnosticChecklist,
  resolveReadyGatePrepareEntryFailureCopy,
  type ReadyGateDiagnosticCopy,
} from '@clientShared/matching/readyGateDiagnosticCopy';

const GATE_TIMEOUT_SEC = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const READY_GATE_TRUTH_RECONCILE_MS = 10_000;
const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;

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
  const [permissionRequestEligible, setPermissionRequestEligible] = useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(null);
  const [prepareEntryFailureCode, setPrepareEntryFailureCode] = useState<string | null>(null);
  const [prepareEntryFailureRetryable, setPrepareEntryFailureRetryable] = useState(false);
  const [nativeMediaDiagnostics, setNativeMediaDiagnostics] = useState(defaultNativeReadyGateMediaDiagnostics);
  const [nativePermissionDiagnostics, setNativePermissionDiagnostics] = useState(
    defaultNativeReadyGatePermissionDiagnostics,
  );
  const invalidSessionLoggedRef = useRef(false);
  /** At most one explain-then-navigate dialog per mount / session id (stale vs invalid deep link). */
  const redirectExplainedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const terminalRecoveryKeyRef = useRef<string | null>(null);
  const nonRetryablePrepareBlockerRef = useRef<string | null>(null);
  const expirySyncInFlightRef = useRef(false);
  const expirySyncRetryAtMsRef = useRef(0);
  const readyGateOpenedAtMsRef = useRef(Date.now());
  const activeSessionIdRef = useRef<string | null>(sessionId ? String(sessionId) : null);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const refreshNativeMediaDiagnostics = useCallback(async (permission: boolean | null = hasMediaPermission) => {
    const activeSessionId = activeSessionIdRef.current;
    setNativeMediaDiagnostics((current) => ({
      ...current,
      cameraDeviceStatus: permission ? 'checking' : current.cameraDeviceStatus,
      microphoneDeviceStatus: permission ? 'checking' : current.microphoneDeviceStatus,
    }));
    const next = await inspectNativeReadyGateMediaDevices(permission);
    if (activeSessionIdRef.current !== activeSessionId) return;
    setNativeMediaDiagnostics(next);
  }, [hasMediaPermission]);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    const markPermissionResult = (permissions: NativeReadyGatePermissionDiagnosticState) => {
      const ok = permissions.cameraPermissionStatus === 'ok' && permissions.microphonePermissionStatus === 'ok';
      setHasMediaPermission(ok);
      setPermissionsResolved(true);
      setNativePermissionDiagnostics(permissions);
      void refreshNativeMediaDiagnostics(ok);
    };
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const ok =
        granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      const permissions: NativeReadyGatePermissionDiagnosticState = {
        cameraPermissionStatus:
          granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'blocked',
        microphonePermissionStatus:
          granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'blocked',
      };
      markPermissionResult(permissions);
      return ok;
    }
    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const permissions: NativeReadyGatePermissionDiagnosticState = {
      cameraPermissionStatus: cam.status === 'granted' ? 'ok' : 'blocked',
      microphonePermissionStatus: mic.status === 'granted' ? 'ok' : 'blocked',
    };
    markPermissionResult(permissions);
    const ok = permissions.cameraPermissionStatus === 'ok' && permissions.microphonePermissionStatus === 'ok';
    return ok;
  }, [refreshNativeMediaDiagnostics]);

  useEffect(() => {
    activeSessionIdRef.current = sessionId ? String(sessionId) : null;
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
        ready_gate_expires_at: vs?.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
      });

      if (startable.ok) {
        if (dateNavigationStartedRef.current) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_duplicate_date_nav_suppressed', {
            session_id: sid,
            source,
            startable_reason: startable.reason,
          });
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
          dateNavigationStartedRef.current = false;
          setTransitioning(false);
          clearDateEntryTransition(sid);
          setPrepareEntryFailureCode(prepared.code);
          setPrepareEntryFailureRetryable(prepared.retryable);
          setTerminalActionError(resolveReadyGatePrepareEntryFailureCopy({
            code: prepared.code,
            platform: 'native',
          }).message);
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_prepare_entry_failed_before_date_nav', {
            session_id: sid,
            user_id: user.id,
            event_id: eventId,
            source,
            code: prepared.code,
            retryable: prepared.retryable,
          });
          if (
            isReadyGatePrepareEntryNonRetryable({
              code: prepared.code,
              errorCode: prepared.code,
              source: 'prepare_entry',
            })
          ) {
            nonRetryablePrepareBlockerRef.current = `${sid}:${prepared.code}`;
          }
          return false;
        }
        const prewarm = startNativeVideoDateDailyPrewarm({
          sessionId: sid,
          userId: user.id,
          eventId: eventId ?? null,
          roomName: prepared.data.room_name,
          roomUrl: prepared.data.room_url,
          source: `ready_standalone_${source}`,
        });
        if (prewarm.ok) {
          void preAuthNativeVideoDateDailyPrewarm({
            sessionId: sid,
            userId: user.id,
            eventId: eventId ?? null,
            roomUrl: prepared.data.room_url,
            token: prepared.data.token,
            source: `ready_standalone_${source}`,
          });
          void joinNativeVideoDateDailyPrewarm({
            sessionId: sid,
            userId: user.id,
            eventId: eventId ?? null,
            roomUrl: prepared.data.room_url,
            token: prepared.data.token,
            source: `ready_standalone_${source}`,
            joinSource: 'both_ready',
          });
        }
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_navigate_to_date', {
          session_id: sid,
          source,
          startable_reason: startable.reason,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at: vs?.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
        });
        setTransitioning(true);
        const navigated = navigateToDateSessionGuarded({
          sessionId: sid,
          pathname,
          mode: 'replace',
          onSuppressed: ({ reason: suppressReason, target }) => {
            rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_navigate_to_date_suppressed', {
              session_id: sid,
              reason: suppressReason,
              target: String(target),
              source,
            });
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
        return false;
      }

      // Terminal / lobby fallback. Always clear latch so the new route cannot be suppressed by a
      // stale entry latch from a previous attempt.
      clearDateEntryTransition(sid);
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
    [eventId, pathname, sessionId, user?.id]
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
    expirySyncInFlightRef.current = false;
    expirySyncRetryAtMsRef.current = 0;
    readyGateOpenedAtMsRef.current = Date.now();
    setTimeLeft(GATE_TIMEOUT_SEC);
    setPermissionsResolved(false);
    setHasMediaPermission(null);
    setTerminalActionPending(false);
    setTerminalActionError(null);
    setPrepareEntryFailureCode(null);
    setPrepareEntryFailureRetryable(false);
    setNativeMediaDiagnostics(defaultNativeReadyGateMediaDiagnostics());
    setNativePermissionDiagnostics(defaultNativeReadyGatePermissionDiagnostics());
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id || !permissionRequestEligible) return;
    if (permissionsResolved) return;
    let cancelled = false;
    void (async () => {
      const ok = await requestMediaPermissions();
      if (cancelled || ok) return;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_permissions_denied', { session_id: sessionId });
    })();
    return () => {
      cancelled = true;
    };
  }, [permissionRequestEligible, permissionsResolved, requestMediaPermissions, sessionId, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id || !sessionLookupDone) return;
    const handleAppState = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void syncSession();
      void reconcileFromCanonicalTruth('app_foreground');
      void retryBroadcastGapRecovery('app_foreground');
    };
    handleAppState(AppState.currentState);
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [reconcileFromCanonicalTruth, retryBroadcastGapRecovery, sessionId, sessionLookupDone, syncSession, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const explainInvalidToTabs = () => {
      if (redirectExplainedRef.current) return;
      redirectExplainedRef.current = true;
      showDialog({
        title: 'Link unavailable',
        message: READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
        variant: 'info',
        primaryAction: { label: 'Continue', onPress: () => router.replace(tabsRootHref()) },
      });
    };
    const load = async () => {
      let revealReadyUi = false;
      setPermissionRequestEligible(false);
      try {
        if (snapshotV2.enabled) {
          const snapshot = await fetchVideoDateSnapshot(String(sessionId), { includeToken: false });
          const recovery = adviseVideoDateSnapshotRecovery(snapshot, {
            expectedSessionId: String(sessionId),
            platform: 'native',
            surface: 'ready_redirect',
          });
          if (snapshot.ok === true) {
            rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_snapshot_v2_loaded', {
              session_id: sessionId,
              event_id: snapshot.eventId,
              phase: snapshot.phase,
              room_present: Boolean(snapshot.room?.url),
            });
            if (recovery.action === 'go_date') {
              await reconcileFromCanonicalTruth(`initial_snapshot_${recovery.reason}`);
              return;
            }
            if (recovery.action === 'go_survey') {
              setTransitioning(true);
              const navigated = navigateToDateSessionGuarded({
                sessionId: recovery.sessionId,
                pathname,
                mode: 'replace',
                onSuppressed: ({ reason: suppressReason, target }) => {
                  rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_snapshot_survey_nav_suppressed', {
                    session_id: recovery.sessionId,
                    reason: suppressReason,
                    target: String(target),
                  });
                },
              });
              if (!navigated) {
                setTransitioning(false);
                revealReadyUi = true;
                const recovered = await reconcileFromCanonicalTruth(`initial_snapshot_${recovery.reason}_nav_suppressed`);
                if (recovered) return;
              }
              if (navigated) return;
            }
            if (recovery.action === 'go_home' && recovery.reason === 'missing_event') {
              explainInvalidToTabs();
              return;
            }
            if (recovery.action === 'go_lobby' && recovery.reason !== 'not_date_ready') {
              router.replace(eventLobbyHref(recovery.eventId));
              return;
            }
            if (recovery.action === 'go_lobby' && recovery.reason === 'not_date_ready') {
              rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_snapshot_lobby_deferred_to_truth', {
                session_id: sessionId,
                event_id: recovery.eventId,
                phase: snapshot.phase,
              });
            }
          } else if (recovery.action === 'invalid') {
            rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_snapshot_v2_rejected', {
              session_id: sessionId,
              error: recovery.reason,
            });
            explainInvalidToTabs();
            return;
          }
        }

        const { data: session } = await supabase
          .from('video_sessions')
          .select('participant_1_id, participant_2_id, event_id, ended_at')
          .eq('id', sessionId)
          .maybeSingle();

        if (!session) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_session_row_missing', { session_id: sessionId });
          explainInvalidToTabs();
          return;
        }

        const isParticipant =
          session.participant_1_id === user.id || session.participant_2_id === user.id;
        if (!isParticipant) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_not_participant', { session_id: sessionId });
          explainInvalidToTabs();
          return;
        }

        if (session.ended_at) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_session_ended', { session_id: sessionId });
          await reconcileFromCanonicalTruth('initial_session_ended');
          return;
        }

        if (!session.event_id) {
          explainInvalidToTabs();
          return;
        }

        const initialTruth = await fetchVideoSessionDateEntryTruthCoalesced(String(sessionId));
        const initialRecovery = adviseVideoSessionTruthRecovery({
          sessionId: String(sessionId),
          eventId: session.event_id,
          truth: initialTruth,
          platform: 'native',
          surface: 'ready_redirect',
        });
        const initialDecision = initialRecovery.routeDecision;
        if (initialRecovery.action !== 'go_ready_gate') {
          if (initialRecovery.action === 'go_date') {
            revealReadyUi = true;
          }
          await reconcileFromCanonicalTruth(`initial_truth_${initialDecision}`);
          return;
        }

        const { data: reg } = await supabase
          .from('event_registrations')
          .select('queue_status')
          .eq('event_id', session.event_id)
          .eq('profile_id', user.id)
          .maybeSingle();

        if (reg?.queue_status !== 'in_ready_gate') {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_not_in_ready_gate', {
            session_id: sessionId,
            queue_status: reg?.queue_status ?? null,
            canonical_decision: initialDecision,
          });
        }

        setEventId(session.event_id);
        setPermissionRequestEligible(true);
        revealReadyUi = true;
        const partnerId =
          session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
        const { data: profile } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
        const partnerProfile = profile as { avatar_url?: unknown; photos?: unknown } | null;
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
  }, [pathname, reconcileFromCanonicalTruth, sessionId, showDialog, snapshotV2.enabled, user?.id]);

  useEffect(() => {
    if (isBothReady && sessionId) {
      rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_seen', { session_id: sessionId });
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
  }, [iAmReady, isBothReady, isForfeited, reconcileFromCanonicalTruth, sessionId, transitioning, user?.id]);

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
  }, [errorCode, eventId, inactiveReason, isForfeited, reason, sessionId, showDialog, status, terminal]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
    if (isSnoozed) setRequestingSnooze(false);
  }, [isSnoozed]);

  const runReadyGateForfeit = useCallback(
    async (reason: 'skip') => {
      if (terminalActionPending) return;
      setTerminalActionPending(true);
      setTerminalActionError(null);
      try {
        const result = await forfeit();
        if (!result.ok) throw new Error('ready_gate_forfeit_failed');
        if (result.status === 'both_ready') {
          setTerminalActionPending(false);
          setTerminalActionError(null);
          return;
        }
        const terminal =
          result.terminal === true ||
          result.isTerminal === true ||
          result.status === 'forfeited' ||
          result.status === 'expired';
        if (!terminal) throw new Error('ready_gate_forfeit_not_terminal');
        setTerminalActionPending(false);
        setTerminalActionError(null);
        if (eventId) router.replace(eventLobbyHref(eventId));
        else if (sessionLookupDone) router.replace(tabsRootHref());
      } catch (e) {
        setTerminalActionError("We couldn't step away. Check your connection and try again.");
        setTerminalActionPending(false);
        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_forfeit_failed_kept_open', {
          session_id: sessionId ?? null,
          event_id: eventId,
          reason,
          message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
        });
      }
    },
    [eventId, forfeit, sessionId, sessionLookupDone, terminalActionPending],
  );

  const syncExpiredReadyGate = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return;
      const now = Date.now();
      if (expirySyncInFlightRef.current || expirySyncRetryAtMsRef.current > now) return;

      expirySyncInFlightRef.current = true;
      expirySyncRetryAtMsRef.current = now + EXPIRY_SYNC_RETRY_DELAY_MS;
      try {
        const result = await syncSession();
        if (result.ok === true && result.expiresAt) {
          setTimeLeft(
            getReadyGateCountdownFromServerClock({
              expiresAt: readyGateClockEnabled ? phaseDeadlineAtMs ?? result.expiresAt : result.expiresAt,
              serverNowMs: readyGateClockEnabled ? serverNowMs : null,
              clientSyncedAtMs: readyGateClockEnabled ? clientSyncedAtMs : null,
              fallbackDeadlineMs: readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
              fallbackSeconds: GATE_TIMEOUT_SEC,
            }).remainingSeconds,
          );
          return;
        }
        if (result.ok === false) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_countdown_expiry_sync_deferred', {
            session_id: sessionId,
            source,
            error: result.error,
          });
        }
      } finally {
        expirySyncInFlightRef.current = false;
      }
    },
    [clientSyncedAtMs, phaseDeadlineAtMs, readyGateClockEnabled, serverNowMs, sessionId, syncSession, user?.id],
  );

  useEffect(() => {
    if (transitioning || iAmReady || markingReady || requestingSnooze || terminalActionPending) return;
    if (isSnoozed && snoozeExpiresAt) {
      const remaining = Math.max(0, Math.floor((new Date(snoozeExpiresAt).getTime() - Date.now()) / 1000));
      setSnoozeTimeLeft(remaining);
      return;
    }
    const t = setInterval(() => {
      setTimeLeft(() => {
        const next = getReadyGateCountdownFromServerClock({
          expiresAt: readyGateClockEnabled ? phaseDeadlineAtMs ?? expiresAt : expiresAt,
          serverNowMs: readyGateClockEnabled ? serverNowMs : null,
          clientSyncedAtMs: readyGateClockEnabled ? clientSyncedAtMs : null,
          fallbackDeadlineMs: readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
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
      message: "You'll return to the lobby. Your match can keep going with others.",
      variant: 'destructive',
      primaryAction: { label: 'Step away', onPress: () => { void runReadyGateForfeit('skip'); } },
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
        <Text style={[styles.loadingHint, { color: theme.textSecondary }]}>Opening Ready Gate…</Text>
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
  const showConnectingReadinessCopy = readyGateReadinessCopy.key === 'both_ready_connecting';
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
        : 'unknown',
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
        if (row.key === 'video_provider' && prepareEntryFailureRetryable) {
          void reconcileFromCanonicalTruth('diagnostic_retry');
          return;
        }
        void refreshNativeMediaDiagnostics();
        return;
      case 'check_connection':
        void syncSession();
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
        <Ionicons name="videocam-off-outline" size={34} color={theme.textSecondary} />
        <Text style={[styles.transitioningTitle, { color: theme.text, marginTop: spacing.md }]}>Camera and mic required</Text>
        <Text style={[styles.transitioningSub, { color: theme.textSecondary }]}>
          Allow camera and microphone access to join this date.
        </Text>
        <ReadyGateDiagnosticChecklist
          rows={diagnosticChecklist.rows}
          theme={theme}
          actionDisabled={terminalActionPending}
          onAction={handleDiagnosticAction}
        />
        <VibelyButton label="Enable permissions" onPress={() => void requestMediaPermissions()} variant="primary" size="lg" />
        <Pressable
          onPress={() => {
            if (eventId) router.replace(eventLobbyHref(eventId));
            else router.replace(tabsRootHref());
          }}
          style={styles.ghostBtn}
        >
          <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Back to lobby</Text>
        </Pressable>
      </View>
    );
  }

  if (transitioning) {
    return (
      <View style={[styles.transitioningWrap, { backgroundColor: theme.background }]}>
        {dialogEl}
        <View style={[styles.transitioningIconWrap, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="sparkles" size={40} color={theme.tint} />
        </View>
        <Text style={[styles.transitioningTitle, { color: theme.text }]}>Joining your date...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable onPress={handleSkip} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>Ready to vibe?</Text>
      </GlassHeaderBar>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
          <Text style={[styles.partnerLabel, { color: theme.textSecondary }]}>Your match</Text>
          <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle, borderColor: withAlpha(theme.tint, 0.25) }]}>
            {partnerAvatar ? (
              <Image source={{ uri: avatarUrl(partnerAvatar) }} style={styles.avatarImg} />
            ) : (
              <Ionicons name="person" size={48} color={theme.textSecondary} />
            )}
          </View>
          <Text style={[styles.partnerName, { color: theme.text }]}>{partnerName ?? 'Your match'}</Text>

          <View style={[styles.statusPill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.statusText, { color: theme.text }]}>{statusLine}</Text>
          </View>

          {partnerReady && !iAmReady && (
            <View style={[styles.readyCue, { backgroundColor: theme.successSoft ?? theme.tintSoft, borderColor: theme.success ?? withAlpha(theme.tint, 0.31) }]}>
              <Ionicons name="checkmark-circle" size={20} color={theme.success || theme.tint} />
              <Text style={[styles.readyCueText, { color: theme.text }]}>{partnerName ?? 'Partner'} is ready and waiting!</Text>
            </View>
          )}

          {snoozedByPartner && (
            <View style={[styles.snoozeCue, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Ionicons name="time-outline" size={20} color={theme.textSecondary} />
              <Text style={[styles.snoozeCueText, { color: theme.textSecondary }]}>{partnerName ?? 'Partner'} needs a moment — they'll be right back!</Text>
            </View>
          )}

          {terminalActionError ? (
            <Text style={[styles.actionError, { color: theme.danger }]}>{terminalActionError}</Text>
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
                label={markingReady ? 'Marking ready...' : "I'm Ready ✨"}
                onPress={() => {
                  if (markingReady || requestingSnooze || terminalActionPending) return;
                  setMarkingReady(true);
                  void (async () => {
                    try {
                      setTerminalActionError(null);
                      const result = await markReady();
                      if (!result.ok) throw new Error('ready_gate_mark_ready_failed');
                    } catch (e) {
                      setTerminalActionError("We couldn't mark you ready. Check your connection and try again.");
                      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_mark_ready_failed_kept_open', {
                        session_id: sessionId,
                        event_id: eventId,
                        message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
                      });
                    } finally {
                      setMarkingReady(false);
                    }
                  })();
                }}
                variant="primary"
                size="lg"
                style={styles.primaryBtn}
                disabled={markingReady || requestingSnooze || terminalActionPending}
              />
              <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
              </Text>
              <View style={styles.secondaryRow}>
                <Pressable
                  onPress={() => {
                    if (requestingSnooze || markingReady || terminalActionPending) return;
                    setRequestingSnooze(true);
                    void (async () => {
                      try {
                        setTerminalActionError(null);
                        const result = await snooze();
                        if (!result.ok) throw new Error('ready_gate_snooze_failed');
                      } catch (e) {
                        setTerminalActionError("We couldn't snooze this match. Check your connection and try again.");
                        rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_snooze_failed_kept_open', {
                          session_id: sessionId,
                          event_id: eventId,
                          message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
                        });
                      } finally {
                        setRequestingSnooze(false);
                      }
                    })();
                  }}
                  disabled={requestingSnooze || markingReady || terminalActionPending}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze || markingReady || terminalActionPending) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>
                    {requestingSnooze ? 'Snoozing...' : 'Snooze — give me 2 min'}
                  </Text>
                </Pressable>
                <Text style={[styles.dot, { color: theme.textSecondary }]}>·</Text>
                <Pressable
                  onPress={handleSkip}
                  disabled={requestingSnooze || markingReady || terminalActionPending}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze || markingReady || terminalActionPending) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>
                    {terminalActionPending ? 'Leaving...' : 'Step away'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.waitingPill, { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.31) }]}>
                <Ionicons
                  name={readinessStatusIcon}
                  size={22}
                  color={theme.tint}
                />
                <Text style={[styles.waitingText, { color: theme.text }]}>{readyGateReadinessCopy.text}</Text>
              </View>
              <Pressable
                onPress={handleSkip}
                disabled={terminalActionPending}
                style={({ pressed }) => [styles.ghostBtn, terminalActionPending && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  loadingHint: { marginTop: spacing.md, fontSize: 15, textAlign: 'center' },
  headerBar: { marginBottom: 0 },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.xl },
  partnerLabel: { fontSize: 12, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  partnerName: { ...typography.titleLG, marginBottom: spacing.lg },
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
  primaryBtn: { alignSelf: 'stretch' },
  helperText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ghostBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  ghostBtnText: { fontSize: 13 },
  dot: { fontSize: 14 },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  transitioningTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.xs },
  transitioningSub: { fontSize: 14 },
});
