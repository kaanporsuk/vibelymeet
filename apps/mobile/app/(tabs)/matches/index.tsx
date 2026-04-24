import React, { useMemo, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import {
  StyleSheet,
  Pressable,
  FlatList,
  ListRenderItem,
  RefreshControl,
  ScrollView,
  View as RNView,
  Text as RNText,
  TextInput,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
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
import { useMatches, type MatchListItem } from '@/lib/chatApi';
import { formatConversationCount } from '@/lib/matchSortScore';
import { useUndoableUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { useArchiveMatch } from '@/lib/useArchiveMatch';
import { useMuteMatch } from '@/lib/useMuteMatch';
import { MatchActionsSheet } from '@/components/match/MatchActionsSheet';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { ProfileDetailSheet } from '@/components/match/ProfileDetailSheet';
import { UnmatchSnackbar } from '@/components/match/UnmatchSnackbar';
import { UnmatchConfirmationSheet } from '@/components/match/UnmatchConfirmationSheet';
import { SwipeableMatchConversationRow } from '@/components/matches/SwipeableMatchConversationRow';
import { DropsTabContent } from '@/components/matches/DropsTabContent';
import { ArchivedMatchesSection } from '@/components/matches/ArchivedMatchesSection';
import { WhoLikedYouGate } from '@/components/premium/WhoLikedYouGate';
import { useEntitlements } from '@/hooks/useEntitlements';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { OnBreakBanner } from '@/components/OnBreakBanner';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { getMatchSearchHitKind } from '@/lib/matchSearchHaystack';
import {
  MATCHES_CONVERSATION_SORT_STORAGE_KEY,
  type ConversationSortOption,
  conversationSortShortLabel,
  orderIndexByMatchId as buildOrderIndexByMatchId,
  parseStoredConversationSort,
  sortConversations,
} from '@/lib/matchesConversationSort';
import {
  getUtcDateKey,
  resolveMatchesSpotlight,
} from '../../../../../shared/matches/spotlightResolver';
import {
  MATCHES_SEARCH_HINT,
  MATCHES_SEARCH_LEAD,
} from '../../../../../shared/matches/searchUi';

type MatchConversationRow = MatchListItem & { searchMatchHint: string | null };
type SpotlightRow = { kind: 'spotlight'; key: string };
type ConversationsListRow = MatchConversationRow | SpotlightRow;

const SEARCH_MATCH_HINT = {
  name: 'Matched on name',
  vibe: 'Matched on vibe',
  intent: 'Matched on intent',
  location: 'Matched on location',
  event: 'Matched on event',
  message: 'Matched on last message',
} as const;

/** First matching dimension in priority order: name → vibe → intent → event → message. */
function conversationSearchHint(m: MatchListItem, qLower: string): string | null {
  const hitKind = getMatchSearchHitKind(m, qLower);
  if (!hitKind) return null;
  if (hitKind === 'name') return SEARCH_MATCH_HINT.name;
  if (hitKind === 'vibe') return SEARCH_MATCH_HINT.vibe;
  if (hitKind === 'intent') return SEARCH_MATCH_HINT.intent;
  if (hitKind === 'location') return SEARCH_MATCH_HINT.location;
  if (hitKind === 'event') return SEARCH_MATCH_HINT.event;
  if (hitKind === 'message') return SEARCH_MATCH_HINT.message;
  return null;
}

export default function MatchesListScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { canSeeLikedYou } = useEntitlements();
  const { data: matches = [], isLoading, isRefetching, error, refetch } = useMatches(user?.id);
  const isFocused = useIsFocused();
  const [activeTab, setActiveTab] = useState<'conversations' | 'drops'>('conversations');
  const [searchQuery, setSearchQuery] = useState('');
  const [conversationSort, setConversationSort] = useState<ConversationSortOption>('recent');
  const [showSortSheet, setShowSortSheet] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(MATCHES_CONVERSATION_SORT_STORAGE_KEY).then((raw) => {
      setConversationSort(parseStoredConversationSort(raw));
    });
  }, []);

  /** Web parity: hide when this user archived (`useMatches` / `useMatches.ts` isArchived). */
  const activeMatches = useMemo(
    () => matches.filter((m) => !(m.archived_at && m.archived_by === user?.id)),
    [matches, user?.id]
  );
  /** Same rule as web `archivedMatches` — data already on each `MatchListItem`; list UI only. */
  const archivedMatches = useMemo(
    () => matches.filter((m) => !!m.archived_at && m.archived_by === user?.id),
    [matches, user?.id]
  );
  const [openedVibeIds, setOpenedVibeIds] = useState<Set<string>>(new Set());
  /** Sortable conversation rows only — unopened "new" vibes stay in the rail (web parity). */
  const regularMatches = useMemo(
    () => activeMatches.filter((m) => !m.isNew || openedVibeIds.has(m.matchId)),
    [activeMatches, openedVibeIds]
  );
  const newVibes = useMemo(
    () => activeMatches.filter((m) => m.isNew && !openedVibeIds.has(m.matchId)),
    [activeMatches, openedVibeIds]
  );

  const searchTrimmed = searchQuery.trim();
  const showNewVibesRail = searchTrimmed.length === 0;
  const dateKey = getUtcDateKey();
  const matchesSpotlight = useMemo(
    () =>
      resolveMatchesSpotlight({
        userId: user?.id ?? '__anonymous__',
        dateKey,
      }),
    [user?.id, dateKey]
  );
  const spotlightDismissKey = useMemo(
    () =>
      `matches_spotlight_dismissed:${user?.id ?? '__anonymous__'}:${dateKey}:${matchesSpotlight.id}`,
    [user?.id, dateKey, matchesSpotlight.id]
  );
  const [spotlightDismissed, setSpotlightDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(spotlightDismissKey).then((v) => {
      if (!cancelled) setSpotlightDismissed(v === '1');
    });
    return () => {
      cancelled = true;
    };
  }, [spotlightDismissKey]);

  const regularConversationCount = regularMatches.length;
  const shouldShowSpotlightBase = activeTab === 'conversations' && searchTrimmed.length === 0 && !spotlightDismissed;
  const spotlightPlacement: 'empty' | 'footer' | 'inline' | null = shouldShowSpotlightBase
    ? regularConversationCount === 0
      ? 'empty'
      : regularConversationCount <= 3
        ? 'footer'
        : 'inline'
    : null;

  const dismissSpotlightForDay = useCallback(() => {
    setSpotlightDismissed(true);
    void AsyncStorage.setItem(spotlightDismissKey, '1');
  }, [spotlightDismissKey]);

  const filteredMatches = useMemo((): MatchConversationRow[] => {
    if (!searchTrimmed) {
      return regularMatches.map((m) => ({ ...m, searchMatchHint: null }));
    }
    const q = searchTrimmed.toLowerCase();
    const rows: MatchConversationRow[] = [];
    for (const m of regularMatches) {
      const hint = conversationSearchHint(m, q);
      if (hint) rows.push({ ...m, searchMatchHint: hint });
    }
    return rows;
  }, [regularMatches, searchTrimmed]);

  const orderIndexByMatchId = useMemo(() => {
    return buildOrderIndexByMatchId(regularMatches);
  }, [regularMatches]);

  /** After search filter; same sort semantics as web `Matches.tsx`. */
  const displayMatches = useMemo((): MatchConversationRow[] => {
    return sortConversations(filteredMatches, conversationSort, orderIndexByMatchId);
  }, [filteredMatches, conversationSort, orderIndexByMatchId]);

  const applyConversationSort = useCallback((opt: ConversationSortOption) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConversationSort(opt);
    void AsyncStorage.setItem(MATCHES_CONVERSATION_SORT_STORAGE_KEY, opt);
    setShowSortSheet(false);
  }, []);

  const showConversationSortMenu = useCallback(() => {
    setShowSortSheet(true);
  }, []);

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
  const { archiveMatch, unarchiveMatch, isArchiving, isUnarchiving } = useArchiveMatch(user?.id);
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch(user?.id);
  const [actionsMatch, setActionsMatch] = useState<(typeof matches)[0] | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const scrollCloseNonceSV = useSharedValue(0);
  const [activeSwipeMatchId, setActiveSwipeMatchId] = useState<string | null>(null);
  const [unmatchSheetMatch, setUnmatchSheetMatch] = useState<MatchListItem | null>(null);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const handleUnmatch = useCallback(
    (matchId: string, name: string) => {
      showDialog({
        title: 'Unmatch?',
        message: `Remove ${name} from your matches? You’ll have a few seconds to undo.`,
        variant: 'destructive',
        primaryAction: {
          label: 'Unmatch',
          onPress: () => {
            setPendingUnmatchMatchId(matchId);
            setPendingUnmatchName(name);
            initiateUnmatch(matchId);
            setActionsMatch(null);
          },
        },
        secondaryAction: { label: 'Cancel', onPress: () => {} },
      });
    },
    [initiateUnmatch, showDialog]
  );

  const handleBlock = useCallback(
    (blockedId: string, name: string, matchId: string) => {
      showDialog({
        title: 'Block this person?',
        message: `${name} won’t be able to contact you or see your profile.`,
        variant: 'destructive',
        primaryAction: {
          label: 'Block',
          onPress: () => {
            void (async () => {
              setActionLoading('block');
              try {
                await blockUser({ blockedId, matchId });
                setActionsMatch(null);
              } finally {
                setActionLoading(null);
              }
            })();
          },
        },
        secondaryAction: { label: 'Cancel', onPress: () => {} },
      });
    },
    [blockUser, showDialog]
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

  const dismissOpenConversationSwipe = useCallback(() => {
    if (activeSwipeMatchId === null) return;
    scrollCloseNonceSV.value += 1;
    setActiveSwipeMatchId(null);
  }, [activeSwipeMatchId, scrollCloseNonceSV]);

  const onConversationsScrollBeginDrag = useCallback(() => {
    scrollCloseNonceSV.value += 1;
    setActiveSwipeMatchId(null);
  }, [scrollCloseNonceSV]);

  const confirmUnmatchFromSheet = useCallback(() => {
    if (!unmatchSheetMatch) return;
    setPendingUnmatchMatchId(unmatchSheetMatch.matchId);
    setPendingUnmatchName(unmatchSheetMatch.name);
    initiateUnmatch(unmatchSheetMatch.matchId);
  }, [unmatchSheetMatch, initiateUnmatch]);

  const handleInviteFriends = useCallback(() => {
    router.push('/settings/referrals' as Href);
  }, [router]);

  const handleMatchPress = useCallback(
    (item: (typeof matches)[0]) => {
      if (item.isNew) setOpenedVibeIds((prev) => new Set(prev).add(item.matchId));
      (router as { push: (p: string) => void }).push(`/chat/${item.id}`);
    },
    [router]
  );

  const renderSpotlightCard = useCallback(() => {
    return (
      <Card style={[styles.spotlightCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <Pressable
          onPress={dismissSpotlightForDay}
          accessibilityRole="button"
          accessibilityLabel="Dismiss spotlight"
          hitSlop={12}
          style={({ pressed }) => [styles.spotlightDismiss, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
        <RNView style={styles.spotlightRow}>
          <Ionicons name="bulb-outline" size={20} color={theme.tint} />
          <RNText style={[styles.spotlightEyebrow, { color: theme.textSecondary }]}>{matchesSpotlight.eyebrow}</RNText>
        </RNView>
        <RNText style={[styles.spotlightTitle, { color: theme.text }]}>{matchesSpotlight.title}</RNText>
        <RNText style={[styles.spotlightBody, { color: theme.textSecondary }]}>{matchesSpotlight.body}</RNText>
        {matchesSpotlight.ctaLabel && matchesSpotlight.ctaTarget ? (
          <Pressable
            onPress={() => void Linking.openURL(matchesSpotlight.ctaTarget!)}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <RNText style={[styles.spotlightCta, { color: theme.tint }]}>{matchesSpotlight.ctaLabel}</RNText>
          </Pressable>
        ) : null}
      </Card>
    );
  }, [dismissSpotlightForDay, matchesSpotlight, theme]);

  const listData = useMemo((): ConversationsListRow[] => {
    if (spotlightPlacement !== 'inline') return displayMatches;
    const out: ConversationsListRow[] = [];
    for (let i = 0; i < displayMatches.length; i++) {
      out.push(displayMatches[i]!);
      if (i === 1) out.push({ kind: 'spotlight', key: `spotlight:${spotlightDismissKey}` });
    }
    return out;
  }, [displayMatches, spotlightDismissKey, spotlightPlacement]);

  const renderItem: ListRenderItem<ConversationsListRow> = useCallback(
    ({ item }) => {
      if ((item as SpotlightRow).kind === 'spotlight') {
        return <RNView style={styles.inlineSpotlightWrap}>{renderSpotlightCard()}</RNView>;
      }

      const m = item as MatchConversationRow;
      const row = (
        <MatchListRow
          imageUri={m.image}
          name={m.name}
          age={m.age}
          time={m.time}
          conversationPreview={m.conversationPreview}
          unread={m.unread}
          isNew={m.isNew}
          searchMatchHint={m.searchMatchHint}
        />
      );

      if (isUserBlocked(m.id)) {
        return (
          <Pressable
            onPress={() => handleMatchPress(m)}
            onLongPress={() => setActionsMatch(m)}
            style={({ pressed }) => [pressed && { opacity: 0.8 }]}
          >
            {row}
          </Pressable>
        );
      }

      return (
        <SwipeableMatchConversationRow
          matchId={m.matchId}
          backgroundColor={theme.background}
          activeSwipeMatchId={activeSwipeMatchId}
          scrollCloseNonce={scrollCloseNonceSV}
          onSwipeBegin={setActiveSwipeMatchId}
          onSwipeEnd={() => setActiveSwipeMatchId(null)}
          onPress={() => handleMatchPress(m)}
          onLongPress={() => setActionsMatch(m)}
          onSwipeRightCommit={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            (router as { push: (p: string) => void }).push(`/user/${m.id}`);
          }}
          onSwipeLeftCommit={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setUnmatchSheetMatch(m);
          }}
        >
          {row}
        </SwipeableMatchConversationRow>
      );
    },
    [
      activeSwipeMatchId,
      handleMatchPress,
      isUserBlocked,
      router,
      scrollCloseNonceSV,
      theme.background,
      renderSpotlightCard,
    ]
  );

  // ═══════════════════════════════════════════════
  // ALL HOOKS ABOVE — NO HOOKS BELOW THIS LINE
  // Early returns for loading/error states follow
  // ═══════════════════════════════════════════════

  if (error) {
    return (
      <>
        <RNView style={[styles.centeredError, { backgroundColor: theme.background }]}>
          <ErrorState
            message="We couldn't load your matches. Check your connection and try again."
            onActionPress={() => refetch()}
          />
        </RNView>
        {dialogEl}
      </>
    );
  }

  if (!matches.length && !isLoading) {
    const emptySpotlight =
      spotlightPlacement === 'empty' ? (
        <RNView style={styles.emptySpotlightWrap}>{renderSpotlightCard()}</RNView>
      ) : null;

    return (
      <ScreenContainer>
        {dialogEl}
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
          {emptySpotlight}
          <Pressable
            onPress={() => router.push('/settings/referrals' as Href)}
            style={({ pressed }) => [styles.emptyInviteCta, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="people-outline" size={18} color={theme.tint} />
            <RNText style={[styles.emptyInviteCtaText, { color: theme.tint }]}>
              Invite friends to get started
            </RNText>
          </Pressable>
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
        {dialogEl}
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

  return (
    <ScreenContainer>
      {dialogEl}
      <RNView onTouchStart={dismissOpenConversationSwipe}>
      <GlassHeaderBar skipTopInset style={styles.matchesHeaderBar}>
        <RNView style={styles.headerTopRow}>
          <RNView style={styles.headerTitleRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
            <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
          </RNView>
          {regularMatches.length > 0 && (
            <RNView style={[styles.countPill, { backgroundColor: theme.accentSoft }]}>
              <RNText style={[styles.countPillText, { color: theme.tint }]}>
                {formatConversationCount(displayMatches.length)}
              </RNText>
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
        {activeTab === 'conversations' && regularMatches.length > 0 && (
          <RNView style={styles.searchSection}>
            <RNView style={styles.searchRow}>
              <RNView style={[styles.searchInputWrapper, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Ionicons
                  name="search-outline"
                  size={16}
                  color={theme.textSecondary}
                  style={{ marginRight: spacing.xs }}
                />
                {searchQuery.length === 0 ? (
                  <RNView style={styles.searchOverlay} pointerEvents="none">
                    <RNText style={[styles.searchOverlayLead, { color: theme.textSecondary }]}>
                      {MATCHES_SEARCH_LEAD}
                    </RNText>
                    <RNText
                      style={[styles.searchOverlayHint, { color: theme.textSecondary }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {MATCHES_SEARCH_HINT}
                    </RNText>
                  </RNView>
                ) : null}
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder=""
                  accessibilityLabel={`${MATCHES_SEARCH_LEAD} ${MATCHES_SEARCH_HINT}`}
                  style={[styles.searchInput, { color: theme.text }]}
                />
              </RNView>
              <Pressable
                onPress={showConversationSortMenu}
                accessibilityRole="button"
                accessibilityLabel="Sort conversations"
                style={({ pressed }) => [
                  styles.sortIconButton,
                  {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: theme.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name="options-outline" size={20} color={theme.textSecondary} />
              </Pressable>
            </RNView>
            <RNText style={[styles.sortStatusText, { color: theme.textSecondary }]} numberOfLines={1}>
              Sorted by: {conversationSortShortLabel(conversationSort)}
            </RNText>
          </RNView>
        )}
      </GlassHeaderBar>
      </RNView>

      {activeTab === 'conversations' ? (
        <GestureHandlerRootView style={styles.gestureRoot}>
          <FlatList
            data={listData}
            renderItem={renderItem}
            keyExtractor={(item) =>
              (item as SpotlightRow).kind === 'spotlight' ? (item as SpotlightRow).key : (item as MatchConversationRow).matchId
            }
            contentContainerStyle={styles.list}
            onScrollBeginDrag={onConversationsScrollBeginDrag}
            refreshControl={
              <RefreshControl
                refreshing={isFocused && isRefetching && !isLoading}
                onRefresh={handleRefresh}
                tintColor={theme.tint}
              />
            }
          ListEmptyComponent={
            searchTrimmed ? (
              <RNView style={styles.searchEmpty}>
                <Ionicons name="search-outline" size={40} color={theme.textSecondary} />
                <VibelyText variant="titleSM" style={[styles.searchEmptyTitle, { color: theme.text }]}>No matches found</VibelyText>
                <VibelyText variant="bodySecondary" style={[styles.searchEmptySub, { color: theme.textSecondary }]}>Try a different search term</VibelyText>
              </RNView>
            ) : archivedMatches.length > 0 ? (
              <RNView style={styles.archivedOnlyEmpty}>
                <Ionicons name="chatbubbles-outline" size={36} color={theme.textSecondary} />
                <VibelyText variant="titleSM" style={[styles.archivedOnlyTitle, { color: theme.text }]}>
                  No active conversations
                </VibelyText>
                <VibelyText variant="bodySecondary" style={[styles.archivedOnlySub, { color: theme.textSecondary }]}>
                  Restore a chat from Archived below.
                </VibelyText>
              </RNView>
            ) : null
          }
          ListHeaderComponent={
            <RNView onTouchStart={dismissOpenConversationSwipe}>
            <>
              <OnBreakBanner variant="compact" style={{ marginHorizontal: layout.containerPadding, marginBottom: 8 }} />
              {showNewVibesRail && newVibes.length > 0 && !canSeeLikedYou ? (
                <WhoLikedYouGate count={newVibes.length} />
              ) : showNewVibesRail && newVibes.length > 0 && canSeeLikedYou ? (
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
              {spotlightPlacement === 'empty' ? (
                <RNView style={styles.headerSpotlightWrap}>{renderSpotlightCard()}</RNView>
              ) : null}
              {regularMatches.length > 0 ? (
                <RNView style={styles.conversationsDivider}>
                  <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
                  <RNText style={[styles.conversationsLabel, { color: theme.textSecondary }]}>CONVERSATIONS</RNText>
                  <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
                </RNView>
              ) : null}
            </>
            </RNView>
          }
          ListFooterComponent={
            <RNView onTouchStart={dismissOpenConversationSwipe} style={styles.footerCards}>
              <ArchivedMatchesSection
                archivedMatches={archivedMatches}
                activeConversationCount={activeMatches.length}
                onOpenChat={(id) => (router as { push: (p: string) => void }).push(`/chat/${id}`)}
                onRestore={(matchId) => void handleUnarchive(matchId)}
                restoreDisabled={!!actionLoading || isUnarchiving}
              />
              {spotlightPlacement === 'footer' ? renderSpotlightCard() : null}
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
        </GestureHandlerRootView>
      ) : (
        <RNView style={{ flex: 1 }}>
          <OnBreakBanner variant="compact" style={{ marginHorizontal: layout.containerPadding, marginTop: 8, marginBottom: 4 }} />
          <DropsTabContent userId={user?.id} />
        </RNView>
      )}

      <MatchActionsSheet
        visible={!!actionsMatch}
        onClose={() => setActionsMatch(null)}
        matchName={actionsMatch?.name ?? ''}
        isArchived={!!actionsMatch?.archived_at && actionsMatch?.archived_by === user?.id}
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

      <UnmatchConfirmationSheet
        visible={!!unmatchSheetMatch}
        onClose={() => setUnmatchSheetMatch(null)}
        name={unmatchSheetMatch?.name ?? ''}
        imageUri={unmatchSheetMatch?.image ?? ''}
        onConfirmUnmatch={confirmUnmatchFromSheet}
        onReportInstead={() => {
          if (unmatchSheetMatch) {
            setReportTarget({ id: unmatchSheetMatch.id, name: unmatchSheetMatch.name });
          }
        }}
      />

      <KeyboardAwareBottomSheetModal
        visible={showSortSheet}
        onRequestClose={() => setShowSortSheet(false)}
        scrollable={false}
        showHandle
        maxHeightRatio={0.5}
      >
        <RNView style={styles.sortSheetHeader}>
          <VibelyText variant="titleSM" style={[styles.sortSheetTitle, { color: theme.text }]}>
            Sort conversations
          </VibelyText>
          <VibelyText variant="bodySecondary" style={{ color: theme.textSecondary }}>
            Choose how your chat list is ordered
          </VibelyText>
        </RNView>
        {([
          { key: 'recent', label: 'Most Recent', subtitle: 'Latest activity first' },
          { key: 'needsReply', label: 'Needs Reply', subtitle: 'Chats waiting on you' },
          { key: 'best', label: 'Best Match', subtitle: 'Highest vibe compatibility first' },
        ] as const).map((opt) => {
          const selected = conversationSort === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => applyConversationSort(opt.key)}
              style={({ pressed }) => [
                styles.sortSheetOption,
                {
                  borderColor: selected ? theme.tint : theme.border,
                  backgroundColor: selected ? theme.tintSoft : theme.surfaceSubtle,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
            >
              <RNView style={{ flex: 1 }}>
                <VibelyText variant="body" style={[styles.sortSheetOptionLabel, { color: theme.text }]}>
                  {opt.label}
                </VibelyText>
                <VibelyText variant="caption" style={{ color: theme.textSecondary }}>
                  {opt.subtitle}
                </VibelyText>
              </RNView>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={selected ? theme.tint : theme.textSecondary}
              />
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setShowSortSheet(false)}
          style={({ pressed }) => [
            styles.sortSheetCancel,
            { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <VibelyText variant="body" style={{ color: theme.text }}>
            Cancel
          </VibelyText>
        </Pressable>
      </KeyboardAwareBottomSheetModal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
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
  searchSection: {
    marginTop: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sortStatusText: {
    marginTop: 4,
    marginLeft: 2,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchOverlay: {
    position: 'absolute',
    left: 34,
    right: spacing.md,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  searchOverlayLead: {
    fontSize: 14,
    flexShrink: 0,
  },
  searchOverlayHint: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 13,
  },
  sortIconButton: {
    width: 44,
    height: 40,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  sortSheetHeader: {
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
    gap: 2,
  },
  sortSheetTitle: {
    marginBottom: spacing.xs,
  },
  sortSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sortSheetOptionLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  sortSheetCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    marginTop: spacing.xs,
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
    paddingBottom: 120,
  },
  footerCards: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  inlineSpotlightWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  headerSpotlightWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySpotlightWrap: {
    marginTop: spacing.md,
  },
  spotlightCard: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  spotlightDismiss: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: 6,
    borderRadius: radius.lg,
  },
  spotlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  spotlightEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flex: 1,
  },
  spotlightTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  spotlightBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  spotlightCta: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
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
    paddingBottom: 120,
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
  emptyInviteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyInviteCtaText: {
    fontSize: 15,
    fontWeight: '600',
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
    paddingBottom: 120,
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
  archivedOnlyEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: layout.containerPadding,
  },
  archivedOnlyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  archivedOnlySub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
