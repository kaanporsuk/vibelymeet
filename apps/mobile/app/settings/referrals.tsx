import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, Share, Platform, Pressable } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { spacing, layout, radius, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { GlassHeaderBar, Card, VibelyButton, VibelyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { InviteFriendsSheet } from '@/components/invite/InviteFriendsSheet';
import { buildInviteLandingUrl } from '../../../../shared/inviteLinks';

const SHARE_TITLE = 'Join me on Vibely';
const SHARE_MESSAGE =
  "I'm using Vibely for video dates and real events. Come find your vibe with me.";

type ReferralStatus = {
  referredById: string | null;
  referredByName: string | null;
};

export default function ReferralSettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showInviteSheet, setShowInviteSheet] = useState(false);

  const inviteLink = useMemo(() => buildInviteLandingUrl(user?.id ?? null), [user?.id]);

  useEffect(() => {
    trackEvent('invite_hub_viewed', { platform: 'native' });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      if (!user?.id) {
        setStatus(null);
        setStatusLoading(false);
        return;
      }

      setStatusLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('referred_by')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn('[referrals] failed to load native status', error.message);
        setStatus({ referredById: null, referredByName: null });
        setStatusLoading(false);
        return;
      }

      const referredById = data?.referred_by ?? null;
      if (!referredById) {
        setStatus({ referredById: null, referredByName: null });
        setStatusLoading(false);
        return;
      }

      const { data: referrerData, error: referrerError } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', referredById)
        .maybeSingle();

      if (cancelled) return;
      if (referrerError) {
        console.warn('[referrals] failed to load native referrer', referrerError.message);
      }

      setStatus({
        referredById,
        referredByName: referrerData?.name?.trim() || null,
      });
      setStatusLoading(false);
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const showFeedback = (message: string) => {
    setFeedback(message);
    setTimeout(() => setFeedback(null), 2200);
  };

  const handleShare = async () => {
    const shareBody = `${SHARE_MESSAGE}\n\n${inviteLink}`;
    const result = await Share.share({
      title: SHARE_TITLE,
      message: shareBody,
      url: Platform.OS === 'ios' ? inviteLink : undefined,
    }).catch(() => null);

    if (result?.action === Share.sharedAction) {
      trackEvent('invite_link_shared', { surface: 'referrals_hub', channel: 'share_sheet' });
      showFeedback('Invite shared');
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(inviteLink);
    trackEvent('invite_link_copied', { surface: 'referrals_hub', channel: 'clipboard' });
    showFeedback('Invite link copied');
  };

  const statusTitle = statusLoading
    ? 'Checking your invite status'
    : status?.referredById
      ? status.referredByName
        ? `You joined from ${status.referredByName}'s invite`
        : "You joined from a friend's invite"
      : 'No invite linked yet';

  const statusBody = statusLoading
    ? 'Loading the current referral attribution on your account.'
    : status?.referredById
      ? 'Your account already has an inviter linked, and your own shares keep using your personal Vibely link.'
      : 'Share your personal Vibely link. If a friend lands on Vibely through it, we preserve your referral id for signup attribution.';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar skipTopInset style={{ paddingTop: insets.top + 8 }}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <VibelyText variant="overline" style={[styles.eyebrow, { color: theme.textSecondary }]}>
              Growth
            </VibelyText>
            <VibelyText variant="titleLG" style={[styles.headerTitle, { color: theme.text }]}>
              Invite friends
            </VibelyText>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: layout.mainContentPaddingTop, paddingBottom: Math.max(insets.bottom, spacing.xl) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card variant="glass" style={[styles.heroCard, { borderColor: theme.tintSoft }]}>
            <View style={[styles.iconCircle, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name="people-outline" size={22} color={theme.tint} />
            </View>
            <VibelyText variant="titleMD" style={[styles.cardTitle, { color: theme.text }]}>
              Your referral link is ready
            </VibelyText>
            <VibelyText variant="body" style={[styles.cardBody, { color: theme.textSecondary }]}>
              Share one canonical Vibely link for signup attribution. Friends land on the existing
              invite flow and keep your ref attached.
            </VibelyText>

            <View style={[styles.linkBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <VibelyText variant="overline" style={[styles.linkLabel, { color: theme.textSecondary }]}>
                Invite link
              </VibelyText>
              <VibelyText variant="body" style={[styles.linkValue, { color: theme.text }]}>
                {inviteLink}
              </VibelyText>
            </View>

            <View style={styles.actionsRow}>
              <VibelyButton label="Share" onPress={() => void handleShare()} style={styles.actionBtn} />
              <VibelyButton
                label="Copy link"
                variant="secondary"
                onPress={() => void handleCopy()}
                style={styles.actionBtn}
              />
            </View>

            <VibelyButton
              label="More invite options"
              variant="ghost"
              onPress={() => setShowInviteSheet(true)}
              style={styles.moreButton}
            />
          </Card>

          <Card variant="glass" style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#10B981" />
              </View>
              <View style={styles.statusCopy}>
                <VibelyText variant="titleMD" style={[styles.cardTitle, { color: theme.text }]}>
                  {statusTitle}
                </VibelyText>
                <VibelyText variant="body" style={[styles.cardBody, { color: theme.textSecondary }]}>
                  {statusBody}
                </VibelyText>
              </View>
            </View>
            {status?.referredById ? (
              <View style={[styles.metaPill, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <VibelyText variant="caption" style={[styles.metaText, { color: theme.textSecondary }]}>
                  Existing referred_by: {status.referredById}
                </VibelyText>
              </View>
            ) : null}
          </Card>

          <Card variant="glass" style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(232,67,147,0.12)' }]}>
                <Ionicons name="sparkles-outline" size={22} color="#E84393" />
              </View>
              <View style={styles.statusCopy}>
                <VibelyText variant="titleMD" style={[styles.cardTitle, { color: theme.text }]}>
                  What this foundation covers
                </VibelyText>
                <VibelyText variant="body" style={[styles.cardBody, { color: theme.textSecondary }]}>
                  Vibely keeps the existing invite URLs, real share flow, and backend referred_by linkage
                  without adding a new reward or campaign system.
                </VibelyText>
              </View>
            </View>
          </Card>
        </View>
      </ScrollView>

      {feedback ? (
        <View style={styles.feedbackWrap} pointerEvents="none">
          <View style={[styles.feedbackToast, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <VibelyText variant="body" style={{ color: theme.text }}>
              {feedback}
            </VibelyText>
          </View>
        </View>
      ) : null}

      <InviteFriendsSheet
        visible={showInviteSheet}
        onClose={() => setShowInviteSheet(false)}
        analyticsSurface="referrals_hub"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  main: {
    paddingHorizontal: layout.containerPadding,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    fontWeight: '700',
  },
  heroCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
  },
  statusCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: fonts.display,
    fontWeight: '700',
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 21,
  },
  linkBox: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  linkLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  linkValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
  moreButton: {
    marginTop: -4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  statusCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  metaPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  metaText: {
    fontSize: 12,
  },
  feedbackWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  feedbackToast: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
