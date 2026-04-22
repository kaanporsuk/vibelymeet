/**
 * In-lobby ready gate: server-backed `ready_gate_transition` + realtime, aligned with web ReadyGateOverlay.
 * No visual redesign — behavior and state machine parity only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import * as Sentry from '@sentry/react-native';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useReadyGate } from '@/lib/readyGateApi';
import { updateParticipantStatus } from '@/lib/videoDateApi';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { supabase } from '@/lib/supabase';
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from '@shared/matching/videoSessionFlow';
import { markVideoDateEntryPipelineStarted } from '@/lib/dateEntryTransitionLatch';
import { trackEvent } from '@/lib/analytics';

const RING_SIZE = 88;
const STROKE = 4;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const GATE_TIMEOUT_SEC = 30;

function vdbg(message: string, data?: Record<string, unknown>) {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: 'vdbg',
    message,
    level: 'info',
    data: payload,
  });
}

export type ReadyGateOverlayProps = {
  sessionId: string;
  eventId: string;
  userId: string;
  partnerImageUri?: string | null;
  onNavigateToDate: (sessionId: string) => void;
  onClose: () => void;
};

export function ReadyGateOverlay({
  sessionId,
  eventId,
  userId,
  partnerImageUri,
  onNavigateToDate,
  onClose,
}: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { show } = useVibelyDialog();
  const closedRef = useRef(false);
  const invalidSessionNotifiedRef = useRef(false);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);

  const logJourney = useCallback(
    (event: string, payload?: Record<string, unknown>, dedupeKey?: string) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyRef.current.has(key)) return;
      loggedJourneyRef.current.add(key);
      trackEvent(`video_date_journey_${event}`, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, { sessionId, eventId, ...(payload ?? {}) });
    },
    [sessionId, eventId]
  );

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

  const handleBothReady = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setIsTransitioning(true);
    rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_both_ready_seen', { event_id: eventId, session_id: sessionId });
    rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_both_ready', { eventId });
    logJourney('ready_gate_both_ready_handoff_started', { source: 'both_ready' });
    markVideoDateEntryPipelineStarted(sessionId);
    vdbg('lobby_navigate_to_date', {
      trigger: 'ready_gate_overlay_both_ready',
      sessionId,
      eventId,
    });
    // in_handshake / in_date are set from the video date screen when Daily actually starts (parity with standalone Ready Gate).
    setTimeout(() => {
      onNavigateToDate(sessionId);
    }, 1200);
  }, [sessionId, onNavigateToDate, eventId]);

  const handleForfeited = useCallback(
    async (_reason: 'timeout' | 'skip') => {
      if (closedRef.current) return;
      closedRef.current = true;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_forfeited', { reason: _reason, eventId });
      logJourney('ready_gate_forfeited', { reason: _reason }, `ready_gate_forfeited_${_reason}`);
      await updateParticipantStatus(eventId, 'browsing');
      show({
        title: _reason === 'timeout' ? "They weren't ready" : 'No worries',
        message:
          _reason === 'timeout'
            ? 'Back to browsing — your deck is waiting.'
            : 'Back to browsing 💚',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      onClose();
    },
    [eventId, show, onClose, logJourney],
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
    loggedJourneyRef.current.clear();
    setTimeLeft(GATE_TIMEOUT_SEC);
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setPermissionsResolved(false);
    setHasMediaPermission(null);
    logJourney('ready_gate_opened');
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await requestMediaPermissions();
      if (cancelled) return;
      if (!ok) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'lobby_overlay_permissions_denied', { eventId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestMediaPermissions, eventId]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
    void updateParticipantStatus(eventId, 'in_ready_gate');
  }, [eventId, userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: reg }, { data: vs }] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('queue_status')
          .eq('event_id', eventId)
          .eq('profile_id', userId)
          .maybeSingle(),
        supabase.from('video_sessions').select('ended_at').eq('id', sessionId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (!vs || vs.ended_at != null || reg?.queue_status !== 'in_ready_gate') {
        logJourney('ready_gate_invalidated', {
          reason: !vs ? 'missing_session' : vs.ended_at != null ? 'session_ended' : 'registration_not_in_ready_gate',
          queue_status: reg?.queue_status ?? null,
        });
        if (!invalidSessionNotifiedRef.current) {
          invalidSessionNotifiedRef.current = true;
          show({
            title: 'Ready Gate unavailable',
            message: READY_GATE_STALE_OR_ENDED_USER_MESSAGE,
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
        }
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, eventId, userId, onClose, show, logJourney]);

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
    logJourney('ready_gate_dismissed', { reason: iAmReady ? 'cancel_go_back' : 'skip_this_one' }, 'ready_gate_dismissed');
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
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>Preparing your date...</Text>
          </Card>
        ) : isTransitioning || isBothReady ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>
              Joining your date...
            </Text>
          </Card>
        ) : (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
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
              {!iAmReady && (
                <Text style={[styles.countdownNum, { color: theme.text }]}>{Math.max(0, timeLeft)}</Text>
              )}
            </View>

            <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              You matched with {displayName}!
            </Text>

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

            <View
              style={[
                styles.avatarWrap,
                { borderColor: withAlpha(theme.tint, 0.31), backgroundColor: theme.surfaceSubtle },
              ]}
            >
              {partnerImageUri ? (
                <Image source={{ uri: partnerImageUri }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="person" size={48} color={theme.textSecondary} />
              )}
            </View>

            {!iAmReady ? (
              <>
                <VibelyButton
                  label={markingReady ? 'Marking ready...' : "I'm Ready ✨"}
                  onPress={() => {
                    if (markingReady) return;
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
                  disabled={markingReady}
                />
                <View style={styles.secondaryRow}>
                  <Pressable
                    onPress={() => {
                      if (requestingSnooze) return;
                      setRequestingSnooze(true);
                      void (async () => {
                        try {
                          await snooze();
                        } finally {
                          setRequestingSnooze(false);
                        }
                      })();
                    }}
                    style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                      {requestingSnooze ? 'Snoozing...' : 'Snooze - give me 2 min'}
                    </Text>
                  </Pressable>
                  <Text style={[styles.dot, { color: theme.textSecondary }]}>·</Text>
                  <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
                    <Text style={[styles.skipText, { color: theme.textSecondary }]}>Step away</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.waitingPill, { borderColor: withAlpha(theme.tint, 0.35), backgroundColor: theme.tintSoft }]}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.tint} />
                  <Text style={[styles.waitingPillText, { color: theme.text }]}>
                    Waiting for {displayName}...
                  </Text>
                </View>
                <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.skipText, { color: theme.textSecondary }]}>Cancel & step away</Text>
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
    marginBottom: spacing.xl,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  readyBtn: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
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
