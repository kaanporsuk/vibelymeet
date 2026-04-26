/**
 * In-lobby ready gate: server-backed `ready_gate_transition` + realtime, aligned with web ReadyGateOverlay.
 * No visual redesign — behavior and state machine parity only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Image,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useReadyGate } from '@/lib/readyGateApi';
import { fetchVideoSessionDateEntryTruthCoalesced, updateParticipantStatus } from '@/lib/videoDateApi';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { supabase } from '@/lib/supabase';
import { vdbg } from '@/lib/vdbg';
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from '@shared/matching/videoSessionFlow';
import { trackEvent } from '@/lib/analytics';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from '@clientShared/matching/activeSession';
import { ensureVideoDateStartableBeforeNavigation } from '@/lib/videoDateEntryStartable';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';

const RING_SIZE = 88;
const STROKE = 4;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const GATE_TIMEOUT_SEC = 30;
const READY_GATE_TRUTH_RECONCILE_MS = 10_000;

export type ReadyGateOverlayProps = {
  sessionId: string;
  eventId: string;
  userId: string;
  partnerImageUri?: string | null;
  onNavigateToDate: (sessionId: string) => void;
  onClose: () => void;
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
  onLobbyUserMessage,
}: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const closedRef = useRef(false);
  const invalidSessionNotifiedRef = useRef(false);
  const rgImpressionRef = useRef(false);
  const permissionBlockedRef = useRef(false);
  const openingPartnerWaitRef = useRef(false);
  const openingPermissionWaitRef = useRef(false);
  const terminalTimeoutRef = useRef(false);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const ok =
        granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      setHasMediaPermission(ok);
      setPermissionsResolved(true);
      return ok;
    }
    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const ok = cam.status === 'granted' && mic.status === 'granted';
    setHasMediaPermission(ok);
    setPermissionsResolved(true);
    return ok;
  }, []);

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
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const routedTo =
        canAttemptDaily || decision === 'navigate_date'
          ? 'date'
          : decision === 'navigate_ready'
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

      if (canAttemptDaily || decision === 'navigate_date') {
        closedRef.current = true;
        setIsTransitioning(true);
        onNavigateToDate(sessionId);
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
    [eventId, onClose, onLobbyUserMessage, onNavigateToDate, sessionId, userId]
  );

  const handleBothReady = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setIsTransitioning(true);
    rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_seen', { event_id: eventId, session_id: sessionId });
    rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_both_ready', { eventId });
    trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source: 'both_ready',
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_BOTH_READY, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source: 'both_ready',
    });
    vdbg('lobby_navigate_to_date', {
      trigger: 'ready_gate_overlay_both_ready',
      sessionId,
      eventId,
    });
    // Backend pre-flight: confirm the session is actually startable (or absorb a small replica-lag
    // window via `enter_handshake` + bounded refetch) before delegating to lobby's nav guard. The
    // lobby itself will re-check via the same helper, but doing it here lets the overlay reconcile
    // straight to /ready or lobby without ever touching `/date/[id]` if the gate has already moved
    // away from `both_ready` (forfeit, partner timeout, etc.).
    void (async () => {
      const startable = await ensureVideoDateStartableBeforeNavigation({
        sessionId,
        source: 'ready_gate_overlay_both_ready',
        userId,
      });
      if (startable.ok) {
        // in_handshake / in_date are set from the video date screen when Daily actually starts (parity with standalone Ready Gate).
        onNavigateToDate(sessionId);
        return;
      }
      // Not startable after handshake attempt + retries — fall back to canonical reconcile so the
      // overlay routes to /ready or /lobby with the latch cleared. Reset closed flag so reconcile
      // can drive its own close path.
      closedRef.current = false;
      setIsTransitioning(false);
      await reconcileFromCanonicalTruth('both_ready_pre_nav_not_startable');
    })();
  }, [sessionId, onNavigateToDate, eventId, userId, reconcileFromCanonicalTruth]);

  const handleForfeited = useCallback(
    async (_reason: 'timeout' | 'skip') => {
      if (closedRef.current) return;
      closedRef.current = true;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_forfeited', { reason: _reason, eventId });
      if (!terminalTimeoutRef.current) {
        terminalTimeoutRef.current = true;
        trackEvent(LobbyPostDateEvents.READY_GATE_TIMEOUT, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason: _reason,
        });
      }
      await updateParticipantStatus(eventId, 'browsing');
      onLobbyUserMessage?.(
        _reason === 'timeout'
          ? "They weren't ready. Back to browsing — your deck is waiting."
          : 'No worries — back to browsing 💚',
        'info',
      );
      onClose();
    },
    [eventId, onClose, sessionId, onLobbyUserMessage],
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    markReady,
    snooze,
    forfeit,
    isBothReady,
  } = useReadyGate(sessionId, userId, {
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  useEffect(() => {
    closedRef.current = false;
    invalidSessionNotifiedRef.current = false;
    rgImpressionRef.current = false;
    permissionBlockedRef.current = false;
    openingPartnerWaitRef.current = false;
    openingPermissionWaitRef.current = false;
    terminalTimeoutRef.current = false;
    setTimeLeft(GATE_TIMEOUT_SEC);
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setPermissionsResolved(false);
    setHasMediaPermission(null);
    if (!rgImpressionRef.current) {
      rgImpressionRef.current = true;
      trackEvent(LobbyPostDateEvents.READY_GATE_IMPRESSION, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
      });
    }
  }, [sessionId, eventId]);

  useEffect(() => {
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
  }, [requestMediaPermissions, eventId, sessionId]);

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
    if (!iAmReady || partnerReady || snoozedByPartner) return;
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
    permissionsResolved,
    sessionId,
    snoozedByPartner,
  ]);

  useEffect(() => {
    void updateParticipantStatus(eventId, 'in_ready_gate');
  }, [eventId, userId]);

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
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      if (canAttemptDaily) {
        await reconcileFromCanonicalTruth('overlay_initial_daily_startable_check');
        return;
      }
      if (!vs || decision !== 'navigate_ready') {
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
  }, [eventId, onClose, onLobbyUserMessage, reconcileFromCanonicalTruth, sessionId, userId]);

  useEffect(() => {
    if (isTransitioning || iAmReady || markingReady || snoozedByPartner) return;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) return 0;
        if (prev === 1) {
          void forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isTransitioning, iAmReady, markingReady, snoozedByPartner, forfeit]);

  const progress = timeLeft / GATE_TIMEOUT_SEC;
  const dashOffset = CIRC * (1 - progress);

  const handleSkip = () => {
    trackEvent(LobbyPostDateEvents.READY_GATE_NOT_NOW_TAP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      dismiss_variant: iAmReady ? 'cancel_go_back' : 'skip_this_one',
    });
    closedRef.current = true;
    void forfeit();
    void updateParticipantStatus(eventId, 'browsing');
    onClose();
  };

  const displayName = partnerName || 'someone';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.8)' }]} pointerEvents="auto">
        {permissionsResolved && hasMediaPermission === false ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Ionicons name="videocam-off-outline" size={34} color={theme.textSecondary} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.md }]}>Camera and mic required</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Allow camera and microphone access to join this date.
            </Text>
            <VibelyButton
              label="Enable permissions"
              onPress={() => {
                void requestMediaPermissions();
              }}
              variant="primary"
              size="lg"
              style={styles.readyBtn}
            />
            <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.skipText, { color: theme.textSecondary }]}>Back to lobby</Text>
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
        ) : isTransitioning || isBothReady ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>
              Joining your date...
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: spacing.sm, marginBottom: 0 }]}>
              This should only take a moment.
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
                  <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
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

            {!iAmReady ? (
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
                  label={markingReady ? 'Marking ready...' : "I'm Ready ✨"}
                  onPress={() => {
                    if (markingReady) return;
                    trackEvent(LobbyPostDateEvents.READY_GATE_READY_TAP, {
                      platform: 'native',
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    trackEvent(LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY, {
                      platform: 'native',
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    setMarkingReady(true);
                    void (async () => {
                      try {
                        await markReady();
                      } catch (e) {
                        rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_mark_ready_exception', {
                          message_snippet: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
                        });
                      } finally {
                        setMarkingReady(false);
                      }
                    })();
                  }}
                  variant="primary"
                  size="lg"
                  style={styles.readyBtn}
                  disabled={markingReady || requestingSnooze}
                />
                <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                  Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
                </Text>
                <View style={styles.secondaryRow}>
                  <Pressable
                    onPress={() => {
                      if (requestingSnooze) return;
                      trackEvent(LobbyPostDateEvents.READY_GATE_SNOOZE_TAP, {
                        platform: 'native',
                        session_id: sessionId,
                        event_id: eventId,
                      });
                      setRequestingSnooze(true);
                      void (async () => {
                        try {
                          await snooze();
                        } finally {
                          setRequestingSnooze(false);
                        }
                      })();
                    }}
                    disabled={requestingSnooze || markingReady}
                    style={({ pressed }) => [
                      styles.skipWrap,
                      (requestingSnooze || markingReady) && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                      {requestingSnooze ? 'Snoozing...' : 'Snooze — give me 2 min'}
                    </Text>
                  </Pressable>
                  <Text style={[styles.dot, { color: theme.textSecondary }]}>·</Text>
                  <Pressable
                    onPress={handleSkip}
                    disabled={requestingSnooze || markingReady}
                    style={({ pressed }) => [
                      styles.skipWrap,
                      (requestingSnooze || markingReady) && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>Step away</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.waitingPill, { borderColor: withAlpha(theme.tint, 0.35), backgroundColor: theme.tintSoft }]}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.tint} />
                  <Text style={[styles.waitingPillText, { color: theme.text }]}>
                    You&apos;re ready. Waiting for {displayName}...
                  </Text>
                </View>
                <Pressable
                  onPress={handleSkip}
                  disabled={requestingSnooze || markingReady}
                  style={({ pressed }) => [
                    styles.skipWrap,
                    (requestingSnooze || markingReady) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.skipText, { color: theme.textSecondary }]}>Step away</Text>
                </Pressable>
              </>
            )}
          </Card>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
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
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
    textAlign: 'center',
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
  },
  helperText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  skipWrap: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  waitingPillText: { fontSize: 14, fontWeight: '600' },
});
