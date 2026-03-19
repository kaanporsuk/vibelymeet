import React, { useMemo, useState, useCallback } from 'react';
import { StyleSheet, Pressable, FlatList, ListRenderItem, RefreshControl, ScrollView, View as RNView, Text as RNText, TextInput, Linking, Share, Platform, Image, Alert } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import {
  ScreenContainer,
  Card,
  EmptyState,
  ErrorState,
  VibelyButton,
  GlassHeaderBar,
  MatchListRow,
  MatchListRowSkeleton,
  MatchAvatarSkeleton,
  SettingsRow,
  VibelyText,
} from '@/components/ui';
import { spacing, typography, layout, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useMatches } from '@/lib/chatApi';
import { useUndoableUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { useArchiveMatch } from '@/lib/useArchiveMatch';
import { useMuteMatch } from '@/lib/useMuteMatch';
import { MatchActionsSheet } from '@/components/match/MatchActionsSheet';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { ProfileDetailSheet } from '@/components/match/ProfileDetailSheet';
import { UnmatchSnackbar } from '@/components/match/UnmatchSnackbar';
import { DropsTabContent } from '@/components/matches/DropsTabContent';
import { WhoLikedYouGate } from '@/components/premium/WhoLikedYouGate';
import { useBackendSubscription } from '@/lib/subscriptionApi';

export default function MatchesListScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { isPremium } = useBackendSubscription(user?.id);
  const { data: matches = [], isLoading, isRefetching, error, refetch } = useMatches(user?.id);
  const [activeTab, setActiveTab] = useState<'conversations' | 'drops'>('conversations');
  const [searchQuery, setSearchQuery] = useState('');

  const activeMatches = useMemo(() => matches.filter((m) => !m.archived_at), [matches]);
  const [openedVibeIds, setOpenedVibeIds] = useState<Set<string>>(new Set());
  const newVibes = useMemo(
    () => activeMatches.filter((m) => m.isNew && !openedVibeIds.has(m.matchId)),
    [activeMatches, openedVibeIds]
  );

  const filteredMatches = useMemo(() => {
    if (!searchQuery.trim()) return activeMatches;
    const q = searchQuery.toLowerCase();
    return activeMatches.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.lastMessage ?? '').toLowerCase().includes(q)
    );
  }, [activeMatches, searchQuery]);

  const [pendingUnmatchMatchId, setPendingUnmatchMatchId] = useState<string | null>(null);
  const [pendingUnmatchName, setPendingUnmatchName] = useState<string>('');
  const [profileSheetMatch, setProfileSheetMatch] = useState<{ id: string; name: string; age: number; image: string } | null>(null);
  const { initiateUnmatch, cancelPending } = useUndoableUnmatch({
    onUnmatchComplete: () => {
      setPendingUnmatchMatchId(null);
      setPendingUnmatchName('');
    },
  });
  const { blockUser, isUserBlocked, isBlocking } = useBlockUser(user?.id);
  const { archiveMatch, unarchiveMatch, isArchiving } = useArchiveMatch(user?.id);
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch(user?.id);
  const [actionsMatch, setActionsMatch] = useState<(typeof matches)[0] | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleUnmatch = useCallback(
    (matchId: string, name: string) => {
      Alert.alert('Unmatch?', `Remove ${name} from your matches? You can undo within 5 seconds.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: () => {
            setPendingUnmatchMatchId(matchId);
            setPendingUnmatchName(name);
            initiateUnmatch(matchId);
            setActionsMatch(null);
          },
        },
      ]);
    },
    [initiateUnmatch]
  );

  const handleBlock = useCallback(
    (blockedId: string, name: string, matchId: string) => {
      Alert.alert('Block?', `Block ${name}? They won't be able to contact you or see your profile.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setActionLoading('block');
            try {
              await blockUser({ blockedId, matchId });
              setActionsMatch(null);
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]);
    },
    [blockUser]
  );

  const handleArchive = useCallback(
    async (matchId: string, name: string) => {
      setActionLoading('archive');
      try {
        await archiveMatch({ matchId });
        setActionsMatch(null);
      } finally {
        setActionLoading(null);
      }
    },
    [archiveMatch]
  );

  const handleUnarchive = useCallback(
    async (matchId: string) => {
      setActionLoading('unarchive');
      try {
        await unarchiveMatch({ matchId });
        setActionsMatch(null);
      } finally {
        setActionLoading(null);
      }
    },
    [unarchiveMatch]
  );

  const handleMute = useCallback(
    async (matchId: string, name: string) => {
      setActionLoading('mute');
      try {
        await muteMatch({ matchId, duration: '1day' });
        setActionsMatch(null);
      } finally {
        setActionLoading(null);
      }
    },
    [muteMatch]
  );

  const handleUnmute = useCallback(
    async (matchId: string) => {
      setActionLoading('unmute');
      try {
        await unmuteMatch({ matchId });
        setActionsMatch(null);
      } finally {
        setActionLoading(null);
      }
    },
    [unmuteMatch]
  );

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleInviteFriends = useCallback(() => {
    const link = `https://vibelymeet.com/auth?mode=signup&ref=${user?.id ?? ''}`;
    if (Platform.OS !== 'web' && Share.share) {
      Share.share({
        title: 'Join me on Vibely!',
        message: "I'm using Vibely for video dates — come find your vibe! 💜",
        url: link,
      }).catch(() => {});
    } else {
      Linking.openURL(link);
    }
  }, [user?.id]);

  if (error) {
    return (
      <RNView style={[styles.centeredError, { backgroundColor: theme.background }]}>
        <ErrorState
          message="We couldn't load your matches. Check your connection and try again."
          onActionPress={() => refetch()}
        />
      </RNView>
    );
  }

  if (!matches.length && !isLoading) {
    return (
      <ScreenContainer>
        <GlassHeaderBar skipTopInset style={styles.matchesHeaderBar}>
          <RNView style={styles.headerTitleRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
            <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
          </RNView>
        </GlassHeaderBar>
        <ScrollView
          style={styles.emptyStateScroll}
          contentContainerStyle={styles.emptyStateScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <EmptyState
            showIllustration={true}
            title="Your vibe circle awaits"
            message="Join a video speed dating event to meet people who match your energy. No swiping, just real conversations."
            actionLabel="Find your next event"
            onActionPress={() => router.push('/(tabs)/events')}
          />
          <Pressable
            onPress={() => router.push('/how-it-works' as Href)}
            style={({ pressed }) => [styles.howItWorksLink, pressed && { opacity: 0.8 }]}
          >
            <VibelyText variant="body" style={[styles.howItWorksText, { color: theme.textSecondary }]}>
              How does Vibely work? →
            </VibelyText>
          </Pressable>
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (isLoading && !matches.length) {
    return (
      <ScreenContainer>
        <GlassHeaderBar skipTopInset style={styles.matchesHeaderBar}>
          <RNView style={styles.headerTopRow}>
            <RNView style={styles.headerTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
              <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
            </RNView>
          </RNView>
          <RNView style={[styles.tabsContainer, { backgroundColor: theme.muted }]}>
            <RNView style={[styles.tabTrigger, styles.tabTriggerActive, { backgroundColor: theme.background }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.text} />
              <RNText style={[styles.tabLabel, { color: theme.text, fontWeight: '600' }]}>Chat</RNText>
            </RNView>
            <RNView style={styles.tabTrigger}>
              <Ionicons name="water-outline" size={16} color={theme.mutedForeground} />
              <RNText style={[styles.tabLabel, { color: theme.mutedForeground, fontWeight: '500' }]}>Daily Drop</RNText>
            </RNView>
          </RNView>
        </GlassHeaderBar>
        <ScrollView
          style={styles.skeletonScroll}
          contentContainerStyle={styles.skeletonContent}
          showsVerticalScrollIndicator={false}
        >
          <Card variant="glass" style={styles.newVibesSkeletonCard}>
            <RNView style={styles.newVibesSkeletonHeader}>
              <RNView style={[styles.newVibesSkeletonIcon, { backgroundColor: theme.tintSoft }]} />
              <RNView>
                <RNView style={[styles.newVibesSkeletonTitle, { backgroundColor: theme.muted }]} />
                <RNView style={[styles.newVibesSkeletonSub, { backgroundColor: theme.muted }]} />
              </RNView>
            </RNView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.newVibesSkeletonRail}>
              {[1, 2, 3, 4].map((i) => (
                <MatchAvatarSkeleton key={i} />
              ))}
            </ScrollView>
          </Card>
          <RNView style={styles.conversationsDivider}>
            <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <RNText style={[styles.conversationsLabel, { color: theme.textSecondary }]}>CONVERSATIONS</RNText>
            <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </RNView>
          {[1, 2, 3, 4, 5].map((i) => (
            <MatchListRowSkeleton key={i} />
          ))}
        </ScrollView>
      </ScreenContainer>
    );
  }

  const handleMatchPress = useCallback(
    (item: (typeof matches)[0]) => {
      if (item.isNew) setOpenedVibeIds((prev) => new Set(prev).add(item.matchId));
      if (item.unread) {
        const params = new URLSearchParams({
          otherUserId: item.id,
          name: item.name ?? '',
          image: item.image ?? '',
        });
        (router as { push: (p: string) => void }).push(`/match-celebration?${params.toString()}`);
      } else {
        (router as { push: (p: string) => void }).push(`/chat/${item.id}`);
      }
    },
    [router]
  );

  const renderItem: ListRenderItem<(typeof filteredMatches)[0]> = ({ item }) => (
    <Pressable
      onPress={() => handleMatchPress(item)}
      onLongPress={() => !isUserBlocked(item.id) && setActionsMatch(item)}
      style={({ pressed }) => [pressed && { opacity: 0.8 }]}
    >
      <MatchListRow
        imageUri={item.image}
        name={item.name}
        age={item.age}
        time={item.time}
        lastMessage={item.lastMessage}
        unread={item.unread}
        isNew={item.isNew}
      />
    </Pressable>
  );

  return (
    <ScreenContainer>
      <GlassHeaderBar skipTopInset style={styles.matchesHeaderBar}>
        <RNView style={styles.headerTopRow}>
          <RNView style={styles.headerTitleRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
            <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
          </RNView>
          {matches.length > 0 && (
            <RNView style={[styles.countPill, { backgroundColor: theme.accentSoft }]}>
              <RNText style={[styles.countPillText, { color: theme.tint }]}>{matches.length}</RNText>
            </RNView>
          )}
        </RNView>

        {/* Tabs — web shadcn TabsList (bg-muted rounded-md) + active trigger (bg-background shadow) */}
        <RNView style={[styles.tabsContainer, { backgroundColor: theme.muted }]}>
          <Pressable
            onPress={() => setActiveTab('conversations')}
            style={({ pressed }) => [
              styles.tabTrigger,
              activeTab === 'conversations' && [
                styles.tabTriggerActive,
                { backgroundColor: theme.background },
                Platform.OS === 'ios'
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.08,
                      shadowRadius: 2,
                    }
                  : { elevation: 2 },
              ],
              pressed && { opacity: 0.92 },
            ]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={activeTab === 'conversations' ? theme.text : theme.mutedForeground}
            />
            <RNText
              style={[
                styles.tabLabel,
                {
                  color: activeTab === 'conversations' ? theme.text : theme.mutedForeground,
                  fontWeight: activeTab === 'conversations' ? '600' : '500',
                },
              ]}
            >
              Chat
            </RNText>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('drops')}
            style={({ pressed }) => [
              styles.tabTrigger,
              activeTab === 'drops' && [
                styles.tabTriggerActive,
                { backgroundColor: theme.background },
                Platform.OS === 'ios'
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.08,
                      shadowRadius: 2,
                    }
                  : { elevation: 2 },
              ],
              pressed && { opacity: 0.92 },
            ]}
          >
            <Ionicons
              name="water-outline"
              size={16}
              color={activeTab === 'drops' ? theme.text : theme.mutedForeground}
            />
            <RNText
              style={[
                styles.tabLabel,
                {
                  color: activeTab === 'drops' ? theme.text : theme.mutedForeground,
                  fontWeight: activeTab === 'drops' ? '600' : '500',
                },
              ]}
            >
              Daily Drop
            </RNText>
          </Pressable>
        </RNView>

        {/* Search (only for conversations and when matches exist) */}
        {activeTab === 'conversations' && matches.length > 0 && (
          <RNView style={styles.searchRow}>
            <RNView style={[styles.searchInputWrapper, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <Ionicons
                name="search-outline"
                size={16}
                color={theme.textSecondary}
                style={{ marginRight: spacing.xs }}
              />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search by name or vibe…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
            </RNView>
          </RNView>
        )}
      </GlassHeaderBar>

      {activeTab === 'conversations' ? (
        <FlatList
          data={filteredMatches}
          renderItem={renderItem}
          keyExtractor={(item) => item.matchId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isLoading}
              onRefresh={handleRefresh}
              tintColor={theme.tint}
            />
          }
          ListEmptyComponent={
            searchQuery.trim() ? (
              <RNView style={styles.searchEmpty}>
                <Ionicons name="search-outline" size={40} color={theme.textSecondary} />
                <VibelyText variant="titleSM" style={[styles.searchEmptyTitle, { color: theme.text }]}>No matches found</VibelyText>
                <VibelyText variant="bodySecondary" style={[styles.searchEmptySub, { color: theme.textSecondary }]}>Try a different search term</VibelyText>
              </RNView>
            ) : null
          }
          ListHeaderComponent={
            <>
              {newVibes.length > 0 && !isPremium ? (
                <WhoLikedYouGate count={newVibes.length} />
              ) : newVibes.length > 0 && isPremium ? (
                <Card variant="glass" style={styles.newVibesCard}>
                  <RNView style={styles.newVibesHeader}>
                    <RNView style={[styles.newVibesIconWrap, { backgroundColor: theme.tint }]}>
                      <Ionicons name="sparkles" size={18} color="#fff" />
                    </RNView>
                    <RNView>
                      <VibelyText variant="titleSM" style={[styles.newVibesTitle, { color: theme.text }]}>
                        New Vibes
                      </VibelyText>
                      <VibelyText variant="caption" style={[styles.newVibesSub, { color: theme.textSecondary }]}>
                        {newVibes.length} new connection{newVibes.length !== 1 ? 's' : ''}
                      </VibelyText>
                    </RNView>
                  </RNView>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.newVibesRail}
                  >
                    {newVibes.map((vibe) => (
                      <Pressable
                        key={vibe.matchId}
                        onPress={() => handleMatchPress(vibe)}
                        style={({ pressed }) => [styles.newVibeItem, pressed && { opacity: 0.9 }]}
                      >
                        <RNView style={[styles.newVibeAvatarWrap, vibe.unread && { borderWidth: 2, borderColor: theme.tint }]}>
                          {vibe.image ? (
                            <Image source={{ uri: vibe.image }} style={styles.newVibeAvatar} />
                          ) : (
                            <RNView style={[styles.newVibeAvatarFallback, { backgroundColor: theme.muted }]}>
                              <VibelyText variant="body" style={{ color: theme.textSecondary }}>{vibe.name?.[0] ?? '?'}</VibelyText>
                            </RNView>
                          )}
                          {vibe.unread && <RNView style={[styles.newVibeUnreadDot, { backgroundColor: theme.accent }]} />}
                        </RNView>
                        <VibelyText variant="body" numberOfLines={1} style={[styles.newVibeName, { color: theme.text }]}>
                          {vibe.name?.split(' ')[0] ?? vibe.name}
                        </VibelyText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </Card>
              ) : null}
              <RNView style={styles.conversationsDivider}>
                <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
                <RNText style={[styles.conversationsLabel, { color: theme.textSecondary }]}>CONVERSATIONS</RNText>
                <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
              </RNView>
            </>
          }
          ListFooterComponent={
            <RNView style={styles.footerCards}>
              <Card style={[styles.proTipCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <RNView style={styles.proTipRow}>
                  <Ionicons name="bulb-outline" size={20} color={theme.tint} />
                  <RNText style={[styles.proTipTitle, { color: theme.text }]}>Pro tip</RNText>
                </RNView>
                <RNText style={[styles.proTipBody, { color: theme.textSecondary }]}>
                  Keep the conversation going — reply within 24 hours to keep the vibe alive.
                </RNText>
              </Card>
              <Card style={styles.inviteCard}>
                <SettingsRow
                  icon={<Ionicons name="people-outline" size={22} color={theme.tint} />}
                  title="Invite friends"
                  subtitle="More friends, more vibes. Share Vibely and get matches together."
                  onPress={handleInviteFriends}
                />
              </Card>
            </RNView>
          }
        />
      ) : (
        <DropsTabContent userId={user?.id} />
      )}

      <MatchActionsSheet
        visible={!!actionsMatch}
        onClose={() => setActionsMatch(null)}
        matchName={actionsMatch?.name ?? ''}
        isArchived={!!actionsMatch?.archived_at}
        isMuted={actionsMatch ? isMatchMuted(actionsMatch.matchId) : false}
        onViewProfile={
          actionsMatch
            ? () => {
                setProfileSheetMatch({
                  id: actionsMatch.id,
                  name: actionsMatch.name,
                  age: actionsMatch.age,
                  image: actionsMatch.image,
                });
                setActionsMatch(null);
              }
            : undefined
        }
        onUnmatch={() => actionsMatch && handleUnmatch(actionsMatch.matchId, actionsMatch.name)}
        onArchive={() => actionsMatch && handleArchive(actionsMatch.matchId, actionsMatch.name)}
        onUnarchive={() => actionsMatch && handleUnarchive(actionsMatch.matchId)}
        onBlock={() => actionsMatch && handleBlock(actionsMatch.id, actionsMatch.name, actionsMatch.matchId)}
        onMute={() => actionsMatch && handleMute(actionsMatch.matchId, actionsMatch.name)}
        onUnmute={() => actionsMatch && handleUnmute(actionsMatch.matchId)}
        onReport={() => {
          if (actionsMatch) {
            setReportTarget({ id: actionsMatch.id, name: actionsMatch.name });
            setActionsMatch(null);
          }
        }}
        loading={actionLoading}
      />

      <ProfileDetailSheet
        visible={!!profileSheetMatch}
        onClose={() => setProfileSheetMatch(null)}
        match={profileSheetMatch}
      />

      <UnmatchSnackbar
        visible={!!pendingUnmatchMatchId}
        name={pendingUnmatchName}
        onUndo={() => {
          cancelPending();
          setPendingUnmatchMatchId(null);
          setPendingUnmatchName('');
        }}
      />

      {reportTarget && user?.id && (
        <ReportFlowModal
          visible={!!reportTarget}
          onClose={() => setReportTarget(null)}
          onSuccess={() => setReportTarget(null)}
          reportedId={reportTarget.id}
          reportedName={reportTarget.name}
          reporterId={user.id}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  matchesHeaderBar: { marginBottom: spacing.md },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.titleLG,
  },
  countPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.sm,
    padding: 4,
    borderRadius: 14,
    minHeight: 40,
    alignItems: 'center',
  },
  tabTrigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  tabTriggerActive: {},
  tabLabel: {
    fontSize: 14,
    marginLeft: spacing.xs,
  },
  searchRow: {
    marginTop: spacing.sm,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  conversationsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  conversationsLabel: {
    ...typography.overline,
  },
  list: {
    paddingBottom: layout.scrollContentPaddingBottomTab,
  },
  footerCards: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  proTipCard: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  proTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  proTipTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  proTipBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  inviteCard: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroCard: {
    marginBottom: spacing.xl,
  },
  heroTitle: {
    ...typography.titleLG,
    marginBottom: spacing.xs,
  },
  heroBody: {
    ...typography.bodySecondary,
  },
  dropsShell: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  dropsCard: {
    maxWidth: 400,
    width: '100%',
    padding: spacing.xl,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  dropsIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  dropsTitle: {
    ...typography.titleMD,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  dropsSubtitle: {
    ...typography.bodySecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  dropsCta: {
    alignSelf: 'stretch',
  },
  newVibesCard: {
    marginHorizontal: layout.containerPadding,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  newVibesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  newVibesIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newVibesTitle: { marginBottom: 2 },
  newVibesSub: { fontSize: 12 },
  newVibesRail: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
  },
  newVibeItem: {
    alignItems: 'center',
    minWidth: 64,
  },
  newVibeAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: spacing.xs,
    padding: 2,
  },
  newVibeAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
  },
  newVibeAvatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newVibeUnreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  newVibeName: {
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 64,
  },
  skeletonScroll: { flex: 1 },
  skeletonContent: {
    paddingHorizontal: layout.containerPadding,
    paddingBottom: layout.scrollContentPaddingBottomTab,
  },
  newVibesSkeletonCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  newVibesSkeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  newVibesSkeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  newVibesSkeletonTitle: {
    width: 100,
    height: 16,
    borderRadius: 4,
  },
  newVibesSkeletonSub: {
    width: 80,
    height: 12,
    borderRadius: 4,
    marginTop: 4,
  },
  newVibesSkeletonRail: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  howItWorksLink: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  howItWorksText: {
    fontSize: 14,
  },
  centeredError: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyStateScroll: { flex: 1 },
  emptyStateScrollContent: {
    paddingBottom: layout.scrollContentPaddingBottomTab,
  },
  searchEmpty: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: layout.containerPadding,
  },
  searchEmptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  searchEmptySub: {
    fontSize: 14,
  },
});
