import React, { useMemo, useState, useCallback } from 'react';
import { StyleSheet, Pressable, FlatList, ListRenderItem, Image, RefreshControl, View as RNView, Text as RNText, TextInput, Linking, Share, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { ScreenContainer, SectionHeader, Card, Avatar, EmptyState, ErrorState, LoadingState, VibelyButton } from '@/components/ui';
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
        <RNView style={[styles.headerCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <RNView style={styles.headerTopRow}>
            <RNView style={styles.headerTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
              <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
            </RNView>
            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Settings"
            >
              <Ionicons name="options-outline" size={20} color={theme.text} />
            </Pressable>
          </RNView>
        </RNView>
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

  const renderItem: ListRenderItem<(typeof matches)[0]> = ({ item }) => {
    const isNew = item.time === 'now' || item.time?.endsWith('m');
    return (
      <Link href={`/chat/${item.id}`} asChild>
        <Pressable style={styles.row}>
          <Avatar
            size={52}
            image={<Image source={{ uri: item.image }} style={styles.avatarImage} />}
            fallbackInitials={item.name?.[0]}
          />
          <RNView style={styles.rowBody}>
            <RNView style={styles.rowTop}>
              <RNText style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {item.name}
              </RNText>
              {isNew && (
                <RNView style={[styles.newBadge, { backgroundColor: theme.accentSoft }]}>
                  <RNText style={[styles.newBadgeText, { color: theme.tint }]}>New</RNText>
                </RNView>
              )}
              <RNText style={[styles.time, { color: theme.textSecondary }]} numberOfLines={1}>
                {item.time}
              </RNText>
            </RNView>
            <RNText
              style={[
                styles.preview,
                { color: theme.textSecondary },
                item.unread && { color: theme.text, fontWeight: '600' },
              ]}
              numberOfLines={1}
            >
              {item.lastMessage || 'New match'}
            </RNText>
          </RNView>
          {item.unread && <RNView style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
        </Pressable>
      </Link>
    );
  };

  return (
    <ScreenContainer>
      <RNView style={[styles.headerCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
        <RNView style={styles.headerTopRow}>
          <RNView style={styles.headerTitleRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.tint} />
            <RNText style={[styles.headerTitle, { color: theme.text }]}>Matches</RNText>
          </RNView>
          <RNView style={styles.headerActions}>
            {matches.length > 0 && (
              <RNView style={[styles.countPill, { backgroundColor: theme.accentSoft }]}>
                <RNText style={[styles.countPillText, { color: theme.tint }]}>{matches.length}</RNText>
              </RNView>
            )}
            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Filter or settings"
            >
              <Ionicons name="options-outline" size={20} color={theme.text} />
            </Pressable>
          </RNView>
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
      </RNView>

      {activeTab === 'conversations' ? (
        <FlatList
          data={filteredMatches}
          renderItem={renderItem}
          keyExtractor={(item) => item.matchId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <>
              <RNView style={[styles.conversationsDivider, { borderColor: theme.border }]}>
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
              <Card onPress={handleInviteFriends} style={[styles.inviteCard, { borderColor: theme.border }]}>
                <RNView style={styles.inviteRow}>
                  <RNView style={[styles.inviteIconBox, { backgroundColor: theme.accentSoft }]}>
                    <Ionicons name="people-outline" size={22} color={theme.tint} />
                  </RNView>
                  <RNView style={styles.inviteCopy}>
                    <RNText style={[styles.inviteCardTitle, { color: theme.text }]}>Invite friends</RNText>
                    <RNText style={[styles.inviteCardSub, { color: theme.textSecondary }]}>
                      More friends, more vibes. Share Vibely and get matches together.
                    </RNText>
                  </RNView>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </RNView>
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
  headerCard: {
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIconBtn: {
    padding: spacing.xs,
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
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inviteIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCopy: { flex: 1 },
  inviteCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  inviteCardSub: {
    fontSize: 12,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
    gap: spacing.md,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  rowBody: {
    flex: 1,
    marginLeft: spacing.sm,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
    gap: spacing.xs,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  time: {
    fontSize: 11,
  },
  preview: {
    fontSize: 13,
    marginTop: 2,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: spacing.sm,
  },
});
