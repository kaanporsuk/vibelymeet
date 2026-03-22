import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useDailyDrop } from '@/lib/dailyDropApi';
import { avatarUrl } from '@/lib/imageUrl';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton, LoadingState } from '@/components/ui';
import { spacing, radius, layout, typography } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';

const OPENER_MAX = 140;

export default function DailyDropScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const {
    drop,
    partner,
    openerSentByMe,
    openerText,
    replyText,
    chatUnlocked,
    matchId,
    partnerId,
    timeRemaining,
    isExpired,
    hasDrop,
    isLoading,
    generationRanToday,
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
    refetch,
  } = useDailyDrop(user?.id);

  const [openerInput, setOpenerInput] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [sending, setSending] = useState(false);

  const canSendOpener = !!drop && !drop.opener_sender_id && openerInput.trim().length > 0 && openerInput.trim().length <= OPENER_MAX;
  const canSendReply = !!drop && drop.opener_sender_id && drop.opener_sender_id !== user?.id && !chatUnlocked && replyInput.trim().length > 0;

  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!drop || !user?.id || drop.status === 'invalidated') return;
    const myRole = drop.user_a_id === user.id ? 'a' : 'b';
    const notViewed = myRole === 'a' ? !drop.user_a_viewed : !drop.user_b_viewed;
    if (notViewed && !viewedRef.current.has(drop.id)) {
      viewedRef.current.add(drop.id);
      markViewed();
    }
  }, [drop?.id, drop?.user_a_viewed, drop?.user_b_viewed, user?.id, markViewed]);

  const handleSendOpener = async () => {
    if (!canSendOpener || sending) return;
    setSending(true);
    try {
      await sendOpener(openerInput.trim());
      setOpenerInput('');
    } catch (e) {
      Alert.alert('Error', 'Could not send opener');
    } finally {
      setSending(false);
    }
  };

  const handleSendReply = async () => {
    if (!canSendReply || sending) return;
    setSending(true);
    try {
      await sendReply(replyInput.trim());
      setReplyInput('');
    } catch (e) {
      Alert.alert('Error', 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const handlePass = () => {
    Alert.alert('Pass on this drop?', "You won't be able to message this person through Daily Drop.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pass', style: 'destructive', onPress: () => passDrop() },
    ]);
  };

  if (isLoading && !drop) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading your drop…" message="Finding today's match." />
      </View>
    );
  }

  if (!hasDrop || !drop) {
    const emptySub = generationRanToday
      ? "We looked for your best match today but couldn't find the right fit. Check back tomorrow at 6 PM."
      : 'Your Daily Drop arrives at 6 PM. Come back then to see who we picked for you.';
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <GlassHeaderBar insets={insets} style={styles.headerBar}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Daily Drop</Text>
        </GlassHeaderBar>
        <View style={styles.centered}>
          <View style={[styles.emptyIconWrap, { backgroundColor: withAlpha(theme.tintSoft, 0.38), borderColor: withAlpha(theme.tint, 0.25) }]}>
            <Ionicons name="gift-outline" size={40} color={theme.tint} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No drop for today</Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>{emptySub}</Text>
          <VibelyButton label="Refresh" onPress={() => refetch()} variant="secondary" style={styles.emptyRefresh} />
        </View>
      </View>
    );
  }

  if (drop.status === 'invalidated') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <GlassHeaderBar insets={insets} style={styles.headerBar}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Daily Drop</Text>
        </GlassHeaderBar>
        <View style={styles.centered}>
          <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>⚡</Text>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Drop no longer available</Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
            This drop was removed. Check back at 6 PM for your next one.
          </Text>
          <VibelyButton label="Refresh" onPress={() => refetch()} variant="secondary" style={styles.emptyRefresh} />
        </View>
      </View>
    );
  }

  if (isExpired) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <GlassHeaderBar insets={insets} style={styles.headerBar}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Daily Drop</Text>
        </GlassHeaderBar>
        <View style={styles.centered}>
          <View style={[styles.emptyIconWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="time-outline" size={40} color={theme.textSecondary} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>This drop has expired</Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>You'll get a new match tomorrow.</Text>
          <VibelyButton label="Refresh" onPress={() => refetch()} variant="secondary" style={styles.emptyRefresh} />
        </View>
      </View>
    );
  }

  const photo = partner?.photos?.[0] ?? partner?.avatar_url ?? '';
  const timerMins = Math.floor(timeRemaining / 60);
  const timerSecs = timeRemaining % 60;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Daily Drop</Text>
        <View style={[styles.timerPill, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.timerText, { color: theme.textSecondary }]}>
            {timerMins}:{String(timerSecs).padStart(2, '0')} left
          </Text>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        {partner && (
          <Card variant="glass" style={[styles.partnerCard, { borderColor: theme.glassBorder }]}>
            <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle }]}>
              {photo ? (
                <Image source={{ uri: avatarUrl(photo) }} style={styles.avatar} />
              ) : (
                <Ionicons name="person" size={48} color={theme.textSecondary} />
              )}
            </View>
            <Text style={[styles.partnerName, { color: theme.text }]}>{partner.name}, {partner.age}</Text>
            {partner.bio ? <Text style={[styles.partnerBio, { color: theme.textSecondary }]}>{partner.bio}</Text> : null}
          </Card>
        )}

        {chatUnlocked && matchId && partnerId ? (
          <View style={styles.section}>
            <View style={[styles.connectedCue, { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.31) }]}>
              <Ionicons name="checkmark-circle" size={22} color={theme.tint} />
              <Text style={[styles.connectedText, { color: theme.text }]}>You're connected! Chat is unlocked.</Text>
            </View>
            <Link href={`/chat/${partnerId}`} asChild>
              <Pressable>
                <VibelyButton label="Open chat" variant="primary" style={styles.cta} onPress={() => {}} />
              </Pressable>
            </Link>
          </View>
        ) : openerText ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>First message</Text>
            <View style={[styles.bubble, styles.bubbleThem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.bubbleText, { color: theme.text }]}>{openerText}</Text>
            </View>
            {replyText ? (
              <View style={[styles.bubble, styles.bubbleMe, { backgroundColor: withAlpha(theme.tint, 0.6) }]}>
                <Text style={[styles.bubbleText, { color: '#fff' }]}>{replyText}</Text>
              </View>
            ) : !openerSentByMe && user?.id ? (
              <>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                  placeholder="Reply..."
                  placeholderTextColor={theme.textSecondary}
                  value={replyInput}
                  onChangeText={setReplyInput}
                  multiline
                  editable={!sending}
                />
                <VibelyButton
                  label={sending ? 'Sending…' : 'Send reply'}
                  onPress={handleSendReply}
                  loading={sending}
                  disabled={!canSendReply || sending}
                  variant="primary"
                  style={styles.cta}
                />
              </>
            ) : null}
          </View>
        ) : !drop.opener_sender_id ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Send an opener (max {OPENER_MAX} characters)</Text>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              placeholder="Say hi..."
              placeholderTextColor={theme.textSecondary}
              value={openerInput}
              onChangeText={setOpenerInput}
              maxLength={OPENER_MAX}
              multiline
              editable={!sending}
            />
            <Text style={[styles.charCount, { color: theme.textSecondary }]}>{openerInput.length}/{OPENER_MAX}</Text>
            <VibelyButton
              label={sending ? 'Sending…' : 'Send opener'}
              onPress={handleSendOpener}
              loading={sending}
              disabled={!canSendOpener || sending}
              variant="primary"
              style={styles.cta}
            />
          </View>
        ) : null}

        {!chatUnlocked && (
          <Pressable onPress={handlePass} style={({ pressed }) => [styles.passWrap, pressed && { opacity: 0.8 }]}>
            <Text style={[styles.passText, { color: theme.textSecondary }]}>Pass on this drop</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  headerBar: { marginBottom: 0 },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timerText: { fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: layout.mainContentPaddingTop },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },
  emptyRefresh: { marginTop: spacing.sm },
  partnerCard: {
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatarWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatar: { width: '100%', height: '100%' },
  partnerName: { ...typography.titleLG, marginBottom: spacing.sm },
  partnerBio: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  section: { marginBottom: spacing.xl },
  sectionLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  connectedCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  connectedText: { fontSize: 15, fontWeight: '600' },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleThem: {},
  bubbleMe: {},
  bubbleText: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radius.input,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  charCount: { fontSize: 12, marginBottom: spacing.sm },
  cta: { marginTop: spacing.md },
  passWrap: { marginTop: spacing.xl, paddingVertical: spacing.sm, alignItems: 'center' },
  passText: { fontSize: 14 },
});
