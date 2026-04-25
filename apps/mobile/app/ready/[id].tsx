import { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Image, ScrollView, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
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
import { spacing, radius, typography } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { eventLobbyHref, tabsRootHref } from '@/lib/activeSessionRoutes';
import { navigateToDateSessionGuarded } from '@/lib/dateNavigationGuard';
import { clearDateEntryTransition } from '@/lib/dateEntryTransitionLatch';
import { ensureVideoDateStartableBeforeNavigation } from '@/lib/videoDateEntryStartable';
import { fetchVideoSessionDateEntryTruthCoalesced } from '@/lib/videoDateApi';
import { markNativeVideoDateLaunchIntent, videoDateLaunchBreadcrumb } from '@/lib/videoDateLaunchTrace';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from '@clientShared/matching/activeSession';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import {
  READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
} from '@shared/matching/videoSessionFlow';

const GATE_TIMEOUT_SEC = 30;
const READY_GATE_TRUTH_RECONCILE_MS = 10_000;

export default function ReadyGateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    snoozeExpiresAt,
    markReady,
    forfeit,
    snooze,
    isBothReady,
    isForfeited,
    isSnoozed,
  } = useReadyGate(sessionId ?? null, user?.id ?? null);

  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [snoozeTimeLeft, setSnoozeTimeLeft] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const [sessionLookupDone, setSessionLookupDone] = useState(false);
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const invalidSessionLoggedRef = useRef(false);
  /** At most one explain-then-navigate dialog per mount / session id (stale vs invalid deep link). */
  const redirectExplainedRef = useRef(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const requestMediaPermissions = async (): Promise<boolean> => {
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
  };

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
      router.replace(startable.recommendHref);
      return true;
    },
    [pathname, sessionId, user?.id]
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
    redirectExplainedRef.current = false;
    setPermissionsResolved(false);
    setHasMediaPermission(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      const ok = await requestMediaPermissions();
      if (cancelled || ok) return;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_permissions_denied', { session_id: sessionId });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id]);

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
      try {
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
        const initialDecision = decideVideoSessionRouteFromTruth(initialTruth);
        const initialCanAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(initialTruth);
        if (initialCanAttemptDaily || initialDecision !== 'navigate_ready') {
          if (initialCanAttemptDaily || initialDecision === 'navigate_date') {
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
  }, [reconcileFromCanonicalTruth, sessionId, user?.id, showDialog]);

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
      rcBreadcrumb(RC_CATEGORY.readyGate, 'standalone_forfeited', {
        session_id: sessionId ?? null,
        event_id: eventId,
      });
      if (eventId) router.replace(eventLobbyHref(eventId));
      else if (sessionLookupDone) router.replace(tabsRootHref());
    }
  }, [isForfeited, eventId, sessionLookupDone, sessionId]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
    if (isSnoozed) setRequestingSnooze(false);
  }, [isSnoozed]);

  useEffect(() => {
    if (transitioning || iAmReady || markingReady || requestingSnooze) return;
    if (isSnoozed && snoozeExpiresAt) {
      const remaining = Math.max(0, Math.floor((new Date(snoozeExpiresAt).getTime() - Date.now()) / 1000));
      setSnoozeTimeLeft(remaining);
      return;
    }
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [transitioning, iAmReady, markingReady, requestingSnooze, isSnoozed, snoozeExpiresAt, forfeit]);

  useEffect(() => {
    if (!isSnoozed) return;
    const t = setInterval(() => {
      setSnoozeTimeLeft((prev) => {
        if (prev <= 1) {
          forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isSnoozed, forfeit]);

  const handleSkip = () => {
    showDialog({
      title: 'Step away from this match?',
      message: "You'll return to the lobby. Your match can keep going with others.",
      variant: 'destructive',
      primaryAction: { label: 'Step away', onPress: () => forfeit() },
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

  if (permissionsResolved && hasMediaPermission === false) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {dialogEl}
        <Ionicons name="videocam-off-outline" size={34} color={theme.textSecondary} />
        <Text style={[styles.transitioningTitle, { color: theme.text, marginTop: spacing.md }]}>Camera and mic required</Text>
        <Text style={[styles.transitioningSub, { color: theme.textSecondary }]}>
          Allow camera and microphone access to join this date.
        </Text>
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

  const statusLine = isSnoozed
    ? `${partnerName ?? 'Partner'} needs a moment — back in ${Math.floor(snoozeTimeLeft / 60)}:${String(snoozeTimeLeft % 60).padStart(2, '0')}`
    : iAmReady
      ? `You're ready. Waiting for ${partnerName ?? 'partner'}...`
      : partnerReady
        ? `${partnerName ?? 'Your match'} is ready. Tap Ready when you're ready.`
        : `Ready check ends in ${timeLeft}s`;

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
        </Card>

        <View style={styles.actions}>
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
                    } finally {
                      setMarkingReady(false);
                    }
                  })();
                }}
                variant="primary"
                size="lg"
                style={styles.primaryBtn}
                disabled={markingReady || requestingSnooze}
              />
              <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
              </Text>
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
                  disabled={requestingSnooze || markingReady}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze || markingReady) && { opacity: 0.5 },
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
                  disabled={requestingSnooze || markingReady}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    (requestingSnooze || markingReady) && { opacity: 0.5 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Step away</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.waitingPill, { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.31) }]}>
                <Ionicons name="checkmark-circle" size={22} color={theme.tint} />
                <Text style={[styles.waitingText, { color: theme.text }]}>You're ready! Waiting for {partnerName ?? 'partner'}...</Text>
              </View>
              <Pressable onPress={handleSkip} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Step away</Text>
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
