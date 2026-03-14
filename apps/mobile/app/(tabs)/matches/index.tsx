import React, { useMemo, useState, useCallback } from 'react';
import { StyleSheet, Pressable, FlatList, ListRenderItem, RefreshControl, View as RNView, Text as RNText, TextInput, Linking, Share, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { ScreenContainer, SectionHeader, Card, EmptyState, ErrorState, LoadingState, VibelyButton, GlassSurface, MatchListRow, SettingsRow } from '@/components/ui';
import { spacing, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useMatches } from '@/lib/chatApi';

export default function MatchesListScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data: matches = [], isLoading, error, refetch } = useMatches(user?.id);
  const [activeTab, setActiveTab] = useState<'conversations' | 'drops'>('conversations');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMatches = useMemo(() => {
    if (!searchQuery.trim()) return matches;
    const q = searchQuery.toLowerCase();
    return matches.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.lastMessage ?? '').toLowerCase().includes(q)
    );
  }, [matches, searchQuery]);

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

  if (isLoading && !matches.length) {
    return <LoadingState title="Loading matches" message="Finding people you’ve vibed with at events." />;
  }

  if (error) {
    return (
      <ErrorState
        title="We couldn’t load your matches"
        message="Check your connection and try again."
        actionLabel="Retry"
        onActionPress={() => refetch()}
      />
    );
  }

  if (!matches.length) {
    return (
      <ScreenContainer>
        <GlassSurface style={styles.matchesHeader}>
          <RNView style={styles.headerTopRow}>
            <RNView style={styles.headerTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
              <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
            </RNView>
          </RNView>
        </GlassSurface>
        <Card style={styles.heroCard}>
          <RNText style={[styles.heroTitle, { color: theme.text }]}>Your vibe circle awaits</RNText>
          <RNText style={[styles.heroBody, { color: theme.textSecondary }]}>
            Join a video speed dating event to meet people who match your energy. No swiping, just real conversations.
          </RNText>
        </Card>
        <EmptyState
          title="No matches yet"
          message="Join a Vibely event to start connecting. Your matches will appear here after you vibe with someone."
          actionLabel="Find your next event"
          onActionPress={() => router.push('/(tabs)/events')}
        />
      </ScreenContainer>
    );
  }

  const handleMatchPress = useCallback(
    (item: (typeof matches)[0]) => {
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

  const renderItem: ListRenderItem<(typeof matches)[0]> = ({ item }) => {
    const isNew = item.time === 'now' || item.time?.endsWith('m');
    return (
      <Pressable onPress={() => handleMatchPress(item)} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
        <MatchListRow
          imageUri={item.image}
          name={item.name}
          time={item.time}
          lastMessage={item.lastMessage}
          unread={item.unread}
          isNew={isNew}
        />
      </Pressable>
    );
  };

  return (
    <ScreenContainer>
      <GlassSurface style={styles.matchesHeader}>
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

        {/* Tabs — web parity pill styling */}
        <RNView style={styles.tabsRow}>
          <Pressable
            onPress={() => setActiveTab('conversations')}
            style={[
              styles.tab,
              activeTab === 'conversations' && {
                backgroundColor: theme.accentSoft,
                borderWidth: 1,
                borderColor: theme.tint,
              },
            ]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={activeTab === 'conversations' ? theme.tint : theme.textSecondary}
            />
            <RNText
              style={[
                styles.tabLabel,
                { color: activeTab === 'conversations' ? theme.tint : theme.textSecondary },
              ]}
            >
              Chat
            </RNText>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('drops')}
            style={[
              styles.tab,
              activeTab === 'drops' && {
                backgroundColor: theme.accentSoft,
                borderWidth: 1,
                borderColor: theme.tint,
              },
            ]}
          >
            <Ionicons
              name="water-outline"
              size={16}
              color={activeTab === 'drops' ? theme.tint : theme.textSecondary}
            />
            <RNText
              style={[
                styles.tabLabel,
                { color: activeTab === 'drops' ? theme.tint : theme.textSecondary },
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
                placeholder="Search by name or vibe..."
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
            </RNView>
          </RNView>
        )}
      </GlassSurface>

      {activeTab === 'conversations' ? (
        <FlatList
          data={filteredMatches}
          renderItem={renderItem}
          keyExtractor={(item) => item.matchId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <>
              <RNView style={styles.conversationsDivider}>
                <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
                <RNText style={[styles.conversationsLabel, { color: theme.textSecondary }]}>CONVERSATIONS</RNText>
                <RNView style={[styles.dividerLine, { backgroundColor: theme.border }]} />
              </RNView>
              <SectionHeader
                title="Conversations"
              subtitle="Keep talking with people you’ve met at events."
              />
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
        <RNView style={styles.dropsShell}>
          <RNText style={[styles.dropsTitle, { color: theme.text }]}>Daily Drop</RNText>
          <RNText style={[styles.dropsSubtitle, { color: theme.textSecondary }]}>
            Daily Drop is coming to mobile soon. For now, you can use it on web.
          </RNText>
          <VibelyButton
            label="Open on web"
            onPress={() => {
              Linking.openURL('https://vibelymeet.com/matches');
            }}
            variant="secondary"
            style={{ marginTop: spacing.md }}
          />
        </RNView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  matchesHeader: {
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
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
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 13,
    marginLeft: spacing.xs,
    fontWeight: '600',
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
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  list: {
    paddingBottom: spacing.sm,
  },
  footerCards: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  proTipCard: {
    padding: spacing.md + 2,
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
    padding: spacing.md + 2,
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
    paddingTop: spacing.lg,
  },
  dropsTitle: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
  },
  dropsSubtitle: {
    ...typography.bodySecondary,
  },
});
