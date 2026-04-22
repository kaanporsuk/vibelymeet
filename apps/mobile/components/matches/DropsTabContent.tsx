/**
 * Daily Drop tab content: all states (no drop, unopened, viewed, opener sent, reply, matched, passed, expired) + past drops.
 * Uses useDailyDrop from lib/dailyDropApi.ts. Reference: src/components/matches/DropsTabContent.tsx
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useDailyDrop, type DailyDropPartner, type PastDropRow } from '@/lib/dailyDropApi';
import { avatarUrl } from '@/lib/imageUrl';
import { spacing, radius, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import {
  formatCountdownToNextDailyDropBatchUtc,
  DAILY_DROP_REPLY_MAX_LENGTH,
} from '@/lib/dailyDropSchedule';
import { useVibelyDialog, type VibelyDialogShowConfig } from '@/components/VibelyDialog';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';

const OPENER_MAX_LENGTH = 140;

function formatTimeRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

type Props = {
  userId: string | null | undefined;
};

type BodyProps = Props & { showDialog: (config: VibelyDialogShowConfig) => void };

export function DropsTabContent(props: Props) {
  const { show, dialog } = useVibelyDialog();
  return (
    <>
      <DropsTabContentBody {...props} showDialog={show} />
      {dialog}
    </>
  );
}

function DropsTabContentBody({ userId, showDialog }: BodyProps) {
  const router = useRouter();
  const theme = Colors[useColorScheme()];
  const {
    drop,
    partner,
    partnerId,
    iHaveViewed,
    openerSentByMe,
    openerText,
    replyText,
    chatUnlocked,
    matchId,
    timeRemaining,
    isExpired,
    hasDrop,
    isLoading,
    pickReasons,
    pastDrops,
    generationRanToday,
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
  } = useDailyDrop(userId);

  const [openerInput, setOpenerInput] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [showPastDrops, setShowPastDrops] = useState(false);
  const [sendingOpener, setSendingOpener] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  const handlePass = () => {
    showDialog({
      title: 'Pass on this drop?',
      message: 'This closes it for both of you.',
      variant: 'destructive',
      primaryAction: { label: 'Pass', onPress: () => { void passDrop(); } },
      secondaryAction: { label: 'Stay', onPress: () => {} },
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  if (hasDrop && drop?.status === 'invalidated') {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stateCard}>
          <Text style={styles.invalidatedEmoji} accessibilityRole="text">⚡</Text>
          <Text style={[styles.stateTitle, { color: theme.text }]}>Drop no longer available</Text>
          <Text style={[styles.stateSub, { color: theme.mutedForeground }]}>
            This drop was removed. Your next Daily Drop will appear after the next scheduled batch.
          </Text>
          <Text style={[styles.nextDrop, { color: theme.tint }]}>
            Next batch in {formatCountdownToNextDailyDropBatchUtc()}
          </Text>
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Passed
  if (hasDrop && drop?.passed_by_user_id != null) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stateCard}>
          <Ionicons name="close-circle-outline" size={48} color={theme.mutedForeground} />
          <Text style={[styles.stateTitle, { color: theme.text }]}>This Daily Drop has ended</Text>
          <Text style={[styles.stateSub, { color: theme.mutedForeground }]}>
            Your next Daily Drop arrives after the next batch (UTC).
          </Text>
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Expired
  if (hasDrop && isExpired) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stateCard}>
          <Ionicons name="time-outline" size={48} color={theme.mutedForeground} />
          <Text style={[styles.stateTitle, { color: theme.text }]}>This Daily Drop expired</Text>
          <Text style={[styles.stateSub, { color: theme.mutedForeground }]}>
            A new Daily Drop arrives after the next batch.
          </Text>
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // No drop today
  if (!hasDrop) {
    const emptyBody = generationRanToday
      ? "We looked for your best match today but couldn't find the right fit. Check back tomorrow at 6 PM."
      : 'Your Daily Drop arrives at 6 PM. Come back then to see who we picked for you.';
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stateCard}>
          <Ionicons name="water-outline" size={56} color={theme.mutedForeground} />
          <Text style={[styles.stateTitle, { color: theme.text }]}>No Daily Drop today</Text>
          <Text style={[styles.stateSub, { color: theme.mutedForeground }]}>{emptyBody}</Text>
          <Text style={[styles.nextDrop, { color: theme.tint }]}>
            Next batch in {formatCountdownToNextDailyDropBatchUtc()}
          </Text>
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Matched / chat unlocked
  if (chatUnlocked && matchId) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.stateCard}>
          <Ionicons name="sparkles" size={56} color={theme.tint} />
          <Text style={[styles.stateTitle, { color: theme.text }]}>You're connected! 🎉</Text>
          {openerText ? (
            <View style={[styles.bubble, openerSentByMe ? { alignSelf: 'flex-end', backgroundColor: theme.tint } : { alignSelf: 'flex-start', backgroundColor: theme.muted }]}>
              <Text style={[styles.bubbleText, { color: openerSentByMe ? '#fff' : theme.text }]}>{openerText}</Text>
            </View>
          ) : null}
          {replyText ? (
            <View style={[styles.bubble, !openerSentByMe ? { alignSelf: 'flex-end', backgroundColor: theme.tint } : { alignSelf: 'flex-start', backgroundColor: theme.muted }]}>
              <Text style={[styles.bubbleText, { color: !openerSentByMe ? '#fff' : theme.text }]}>{replyText}</Text>
            </View>
          ) : null}
          <VibelyButton label="Start Chatting" variant="primary" onPress={() => partnerId && (router as { push: (p: string) => void }).push(`/chat/${partnerId}`)} style={styles.cta} />
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Unopened — tap to reveal
  if (!iHaveViewed) {
    const partnerPhoto = resolvePrimaryProfilePhotoPath({
      photos: partner?.photos,
      avatar_url: partner?.avatar_url,
    });
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Pressable onPress={() => markViewed()} style={({ pressed }) => [pressed && { opacity: 0.95 }]}>
          <View style={[styles.revealCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.revealAvatarWrap}>
              {partnerPhoto ? (
                <>
                  <Image source={{ uri: avatarUrl(partnerPhoto) }} style={styles.revealAvatarImg} blurRadius={20} />
                  <BlurView intensity={80} style={StyleSheet.absoluteFill} tint="dark" />
                </>
              ) : (
                <View style={[styles.revealAvatarPlaceholder, { backgroundColor: theme.muted }]} />
              )}
            </View>
            <Text style={[styles.revealLabel, { color: theme.tint }]}>💧 Today's Drop</Text>
            <Text style={[styles.revealHint, { color: theme.mutedForeground }]}>Tap to reveal who we picked for you</Text>
          </View>
        </Pressable>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Partner sent opener — I reply
  if (openerText && !openerSentByMe && !chatUnlocked) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {timeRemaining > 0 && (
          <View style={[styles.countdownBadge, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="time-outline" size={14} color={theme.danger} />
            <Text style={[styles.countdownText, { color: theme.danger }]}>Expires in {formatTimeRemaining(timeRemaining)}</Text>
          </View>
        )}
        <PartnerCard partner={partner} pickReasons={pickReasons} theme={theme} />
        <View style={[styles.bubble, { alignSelf: 'flex-start', backgroundColor: theme.muted }]}>
          <Text style={[styles.bubbleText, { color: theme.text }]}>{openerText}</Text>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            value={replyInput}
            onChangeText={setReplyInput}
            placeholder="Reply to unlock chat..."
            placeholderTextColor={theme.mutedForeground}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            maxLength={DAILY_DROP_REPLY_MAX_LENGTH}
          />
          <Pressable
            onPress={async () => {
              if (!replyInput.trim() || replyInput.length > DAILY_DROP_REPLY_MAX_LENGTH) return;
              setSendingReply(true);
              try {
                await sendReply(replyInput);
                setReplyInput('');
              } catch {
                showDialog({
                  title: 'Couldn’t send',
                  message: 'Your reply didn’t go through. Try again.',
                  variant: 'warning',
                  primaryAction: { label: 'OK', onPress: () => {} },
                });
              } finally {
                setSendingReply(false);
              }
            }}
            disabled={!replyInput.trim() || sendingReply || replyInput.length > DAILY_DROP_REPLY_MAX_LENGTH}
            style={[styles.sendBtn, { backgroundColor: theme.tint }]}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
        <Text style={[styles.charCount, { color: theme.mutedForeground }]}>
          {replyInput.length}/{DAILY_DROP_REPLY_MAX_LENGTH}
        </Text>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // I sent opener — waiting
  if (openerSentByMe && !chatUnlocked) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {timeRemaining > 0 && (
          <View style={[styles.countdownBadge, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="time-outline" size={14} color={theme.danger} />
            <Text style={[styles.countdownText, { color: theme.danger }]}>Expires in {formatTimeRemaining(timeRemaining)}</Text>
          </View>
        )}
        <PartnerCard partner={partner} pickReasons={pickReasons} theme={theme} />
        <View style={[styles.bubble, { alignSelf: 'flex-end', backgroundColor: theme.tint }]}>
          <Text style={[styles.bubbleText, { color: '#fff' }]}>{openerText}</Text>
        </View>
        <View style={styles.waitingRow}>
          <View style={[styles.waitingDot, { backgroundColor: theme.tint }]} />
          <Text style={[styles.waitingText, { color: theme.mutedForeground }]}>Waiting for their reply...</Text>
        </View>
        <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
      </ScrollView>
    );
  }

  // Viewed, no opener yet — send opener
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {timeRemaining > 0 && (
        <View style={[styles.countdownBadge, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="time-outline" size={14} color={theme.danger} />
          <Text style={[styles.countdownText, { color: theme.danger }]}>Expires in {formatTimeRemaining(timeRemaining)}</Text>
        </View>
      )}
      <PartnerCard partner={partner} pickReasons={pickReasons} theme={theme} />
      <View style={styles.inputRow}>
        <TextInput
          value={openerInput}
          onChangeText={setOpenerInput}
          placeholder="Say something..."
          placeholderTextColor={theme.mutedForeground}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          maxLength={OPENER_MAX_LENGTH}
        />
        <Pressable
          onPress={async () => {
            if (!openerInput.trim() || openerInput.length > OPENER_MAX_LENGTH) return;
            setSendingOpener(true);
            try {
              await sendOpener(openerInput);
              setOpenerInput('');
            } catch {
              showDialog({
                title: 'Couldn’t send',
                message: 'Something went wrong. Try again.',
                variant: 'warning',
                primaryAction: { label: 'OK', onPress: () => {} },
              });
            } finally {
              setSendingOpener(false);
            }
          }}
          disabled={!openerInput.trim() || openerInput.length > OPENER_MAX_LENGTH || sendingOpener}
          style={[styles.sendBtn, { backgroundColor: theme.tint }]}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
      <Text style={[styles.charCount, { color: theme.mutedForeground }]}>{openerInput.length}/{OPENER_MAX_LENGTH}</Text>
      <Pressable onPress={handlePass} style={styles.passLink}>
        <Text style={[styles.passLinkText, { color: theme.mutedForeground }]}>Not feeling it?</Text>
      </Pressable>
      <PastDropsSection pastDrops={pastDrops} showPastDrops={showPastDrops} setShowPastDrops={setShowPastDrops} theme={theme} router={router} />
    </ScrollView>
  );
}

function PartnerCard({
  partner,
  pickReasons,
  theme,
}: {
  partner: DailyDropPartner | null;
  pickReasons: string[];
  theme: (typeof Colors)['dark'];
}) {
  if (!partner) return null;
  const photo = resolvePrimaryProfilePhotoPath({
    photos: partner.photos,
    avatar_url: partner.avatar_url,
  });
  const photoUri = photo ? avatarUrl(photo) : null;

  return (
    <View style={[styles.partnerCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.partnerImage} />
      ) : (
        <View style={[styles.partnerImage, styles.partnerImagePlaceholder, { backgroundColor: theme.muted }]}>
          <Ionicons name="person" size={48} color={theme.mutedForeground} />
        </View>
      )}
      <View style={styles.partnerGradient} />
      <View style={styles.partnerInfo}>
        <Text style={[styles.partnerName, { color: theme.text }]}>{partner.name}, {partner.age}</Text>
      </View>
      <View style={styles.partnerBody}>
        {partner.about_me ? <Text style={[styles.partnerBio, { color: theme.mutedForeground }]} numberOfLines={3}>{partner.about_me}</Text> : null}
        {pickReasons.length > 0 && (
          <View style={styles.pickReasonsWrap}>
            <Text style={[styles.pickReasonsLabel, { color: theme.mutedForeground }]}>Why this pick</Text>
            <View style={styles.pickReasonsRow}>
              {pickReasons.map((r, i) => (
                <View key={i} style={[styles.pickReasonChip, { backgroundColor: theme.tintSoft }]}>
                  <Text style={[styles.pickReasonText, { color: theme.tint }]}>{r}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function PastDropsSection({
  pastDrops,
  showPastDrops,
  setShowPastDrops,
  theme,
  router,
}: {
  pastDrops: PastDropRow[];
  showPastDrops: boolean;
  setShowPastDrops: (v: boolean) => void;
  theme: (typeof Colors)['dark'];
  router: ReturnType<typeof useRouter>;
}) {
  if (!pastDrops.length) return null;

  return (
    <View style={styles.pastSection}>
      <Pressable onPress={() => setShowPastDrops(!showPastDrops)} style={styles.pastHeader}>
        <Ionicons name={showPastDrops ? 'chevron-up' : 'chevron-down'} size={20} color={theme.mutedForeground} />
        <Text style={[styles.pastHeaderText, { color: theme.mutedForeground }]}>Past Drops ({pastDrops.length})</Text>
      </Pressable>
      {showPastDrops && (
        <View style={styles.pastList}>
          {pastDrops.map((d) => (
            <Pressable
              key={d.id}
              onPress={() =>
                d.match_id && d.partner_id && (router as { push: (p: string) => void }).push(`/chat/${d.partner_id}`)
              }
              style={[styles.pastRow, { backgroundColor: theme.surfaceSubtle }]}
            >
              {d.partner_avatar ? (
                <Image source={{ uri: avatarUrl(d.partner_avatar) }} style={styles.pastAvatar} />
              ) : (
                <View style={[styles.pastAvatar, { backgroundColor: theme.muted }]}>
                  <Ionicons name="person" size={20} color={theme.mutedForeground} />
                </View>
              )}
              <View style={styles.pastRowText}>
                <Text style={[styles.pastRowName, { color: theme.text }]} numberOfLines={1}>{d.partner_name}</Text>
                <Text style={[styles.pastRowDate, { color: theme.mutedForeground }]}>
                  {new Date(d.drop_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: theme.muted }]}>
                <Text style={[styles.statusBadgeText, { color: theme.mutedForeground }]}>{d.status === 'matched' ? 'Connected' : d.status}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: 120 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stateCard: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  stateTitle: { ...typography.titleMD, marginBottom: spacing.sm, textAlign: 'center' },
  stateSub: { ...typography.body, textAlign: 'center', marginBottom: spacing.sm },
  invalidatedEmoji: { fontSize: 40, marginBottom: spacing.sm, textAlign: 'center' },
  nextDrop: { fontSize: 14, fontWeight: '600' },
  revealCard: {
    padding: spacing.xl,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  revealAvatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  revealAvatarImg: { width: '100%', height: '100%' },
  revealAvatarPlaceholder: { width: '100%', height: '100%' },
  revealLabel: { fontSize: 14, fontWeight: '600', marginBottom: spacing.xs },
  revealHint: { fontSize: 12 },
  partnerCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  partnerImage: { width: '100%', aspectRatio: 3 / 4, backgroundColor: '#1a1a1a' },
  partnerImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partnerGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
    backgroundColor: 'transparent',
  },
  partnerInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg },
  partnerName: { fontSize: 22, fontWeight: '700' },
  partnerBody: { padding: spacing.lg },
  partnerBio: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  pickReasonsWrap: { marginTop: spacing.sm },
  pickReasonsLabel: { fontSize: 12, marginBottom: spacing.xs },
  pickReasonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pickReasonChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pickReasonText: { fontSize: 12, fontWeight: '600' },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    marginBottom: spacing.md,
  },
  countdownText: { fontSize: 12, fontWeight: '600' },
  bubble: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, marginBottom: spacing.sm },
  bubbleText: { fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  charCount: { fontSize: 12, textAlign: 'right', marginBottom: spacing.sm },
  passLink: { alignSelf: 'center', paddingVertical: spacing.sm },
  passLinkText: { fontSize: 12 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: spacing.md },
  waitingDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.7 },
  waitingText: { fontSize: 14 },
  cta: { marginTop: spacing.lg },
  pastSection: { marginTop: spacing.xl },
  pastHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.sm },
  pastHeaderText: { fontSize: 14, fontWeight: '600' },
  pastList: { gap: spacing.sm },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  pastAvatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pastRowText: { flex: 1, minWidth: 0 },
  pastRowName: { fontSize: 14, fontWeight: '600' },
  pastRowDate: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
});
