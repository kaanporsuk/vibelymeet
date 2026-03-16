import { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useReadyGate } from '@/lib/readyGateApi';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton, ErrorState } from '@/components/ui';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

const GATE_TIMEOUT_SEC = 30;

export default function ReadyGateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
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

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const load = async () => {
      const { data: session } = await supabase
        .from('video_sessions')
        .select('participant_1_id, participant_2_id, event_id')
        .eq('id', sessionId)
        .maybeSingle();
      if (!session) return;
      if (session.event_id) setEventId(session.event_id);
      const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
      const { data: profile } = await supabase.from('profiles').select('avatar_url, photos').eq('id', partnerId).maybeSingle();
      if (profile) {
        const photo = (profile.photos as string[])?.[0] ?? profile.avatar_url ?? null;
        setPartnerAvatar(photo);
      }
    };
    load();
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (isBothReady) {
      setTransitioning(true);
      setTimeout(() => router.replace(`/date/${sessionId}`), 1500);
    }
  }, [isBothReady, sessionId]);

  useEffect(() => {
    if (isForfeited) {
      if (eventId) router.replace(`/event/${eventId}/lobby`);
      else router.replace('/(tabs)');
    }
  }, [isForfeited, eventId]);

  useEffect(() => {
    if (transitioning || iAmReady) return;
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
  }, [transitioning, iAmReady, isSnoozed, snoozeExpiresAt, forfeit]);

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
    Alert.alert('Step away?', "You'll go back to the lobby. Your match can continue with others.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Step away', style: 'destructive', onPress: () => forfeit() },
    ]);
  };

  if (!sessionId || !user?.id) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Invalid session"
          message="This ready gate link may have expired or isn't valid."
          actionLabel="Go back"
          onActionPress={() => router.replace('/(tabs)')}
        />
      </View>
    );
  }

  if (transitioning) {
    return (
      <View style={[styles.transitioningWrap, { backgroundColor: theme.background }]}>
        <View style={[styles.transitioningIconWrap, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="sparkles" size={40} color={theme.tint} />
        </View>
        <Text style={[styles.transitioningTitle, { color: theme.text }]}>Connecting your vibe date...</Text>
        <Text style={[styles.transitioningSub, { color: theme.textSecondary }]}>Get ready to shine ✨</Text>
      </View>
    );
  }

  const statusLine = isSnoozed
    ? `${partnerName ?? 'Partner'} needs a moment — back in ${Math.floor(snoozeTimeLeft / 60)}:${String(snoozeTimeLeft % 60).padStart(2, '0')}`
    : iAmReady
      ? `Waiting for ${partnerName ?? 'partner'}...`
      : partnerReady
        ? `${partnerName ?? 'Your match'} is ready! Tap when you're ready.`
        : `Join in ${timeLeft}s`;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>Ready to vibe?</Text>
      </GlassHeaderBar>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
          <Text style={[styles.partnerLabel, { color: theme.textSecondary }]}>Your match</Text>
          <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle, borderColor: theme.tint + '40' }]}>
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
            <View style={[styles.readyCue, { backgroundColor: theme.successSoft ?? theme.tintSoft, borderColor: theme.success ?? theme.tint + '50' }]}>
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
              <VibelyButton label="I'm Ready ✨" onPress={() => markReady()} variant="primary" size="lg" style={styles.primaryBtn} />
              <View style={styles.secondaryRow}>
                <Pressable onPress={() => snooze()} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Snooze — give me 2 min</Text>
                </Pressable>
                <Text style={[styles.dot, { color: theme.textSecondary }]}>·</Text>
                <Pressable onPress={handleSkip} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Not ready? Step away</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.waitingPill, { backgroundColor: theme.tintSoft, borderColor: theme.tint + '50' }]}>
                <Ionicons name="checkmark-circle" size={22} color={theme.tint} />
                <Text style={[styles.waitingText, { color: theme.text }]}>You're ready! Waiting for {partnerName ?? 'partner'}...</Text>
              </View>
              <Pressable onPress={handleSkip} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.ghostBtnText, { color: theme.textSecondary }]}>Cancel & go back</Text>
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
