/**
 * Blocked users — list from get_my_blocked_users; unblock via server-owned RPC.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { type BlockedUser, useBlockUser } from '@/lib/useBlockUser';
import { avatarUrl } from '@/lib/imageUrl';
import { useVibelyDialog } from '@/components/VibelyDialog';

function formatBlockDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export default function BlockedUsersScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    blockedUsers,
    unblockUser,
    blockedUsersError,
    isBlockedUsersLoading,
    isBlockedUsersRefetching,
    refetchBlockedUsers,
    isUnblocking,
  } = useBlockUser(user?.id);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null);

  const listLoading = isBlockedUsersLoading;

  const performUnblock = async (block: BlockedUser) => {
    setPendingUnblockId(block.blocked_id);
    try {
      await unblockUser({ blockedId: block.blocked_id });
    } catch {
      showDialog({
        title: "Couldn't unblock",
        message: 'Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setPendingUnblockId(null);
    }
  };

  const confirmUnblock = (block: BlockedUser) => {
    const name = block.display_name?.trim() || 'Member';
    showDialog({
      title: 'Unblock user?',
      message: `${name} may be able to contact you again if you match later.`,
      variant: 'warning',
      primaryAction: {
        label: 'Unblock',
        onPress: () => {
          void performUnblock(block);
        },
      },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Blocked users</Text>
            <Text style={[styles.headerSubtitle, { color: theme.mutedForeground }]}>
              People you won’t see or hear from
            </Text>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scrollInner, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isBlockedUsersRefetching}
            onRefresh={() => {
              void refetchBlockedUsers();
            }}
            tintColor={theme.tint}
          />
        }
      >
        {listLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.tint} size="large" />
          </View>
        ) : blockedUsersError ? (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={48} color={theme.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Couldn't load blocked users</Text>
            <Text style={[styles.emptyDesc, { color: theme.mutedForeground }]}>
              Check your connection and try again.
            </Text>
            <Pressable
              onPress={() => {
                void refetchBlockedUsers();
              }}
              style={({ pressed }) => [
                styles.retryBtn,
                { borderColor: theme.border },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.unblockLabel, { color: theme.tint }]}>Retry</Text>
            </Pressable>
          </View>
        ) : blockedUsers.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={48} color={theme.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No blocked users</Text>
            <Text style={[styles.emptyDesc, { color: theme.mutedForeground }]}>
              When you block someone, they appear here. You can unblock anytime.
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
            {blockedUsers.map((block, idx) => {
              const rawPhoto = block.avatar_url ?? block.photo_url ?? null;
              const uri = avatarUrl(rawPhoto, 'avatar');
              const name = block.display_name?.trim() || 'Member';
              const blockDate = formatBlockDate(block.created_at);
              const subtitle = [
                blockDate ? `Blocked ${blockDate}` : null,
                block.reason ? block.reason : null,
              ].filter(Boolean).join(' | ');
              const rowPending = pendingUnblockId === block.blocked_id;
              return (
                <View
                  key={block.id}
                  style={[
                    styles.row,
                    idx < blockedUsers.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.glassBorder,
                    },
                  ]}
                >
                  <Image source={{ uri }} style={styles.avatar} />
                  <View style={styles.rowText}>
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                      {name}
                    </Text>
                    {subtitle ? (
                      <Text style={[styles.meta, { color: theme.mutedForeground }]} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => confirmUnblock(block)}
                    disabled={isUnblocking || rowPending}
                    style={({ pressed }) => [
                      styles.unblockBtn,
                      { borderColor: theme.border },
                      (isUnblocking || rowPending) && styles.disabledBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    {rowPending ? (
                      <ActivityIndicator color={theme.tint} size="small" />
                    ) : (
                      <Text style={[styles.unblockLabel, { color: theme.tint }]}>Unblock</Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      {dialogEl}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  scrollInner: {
    padding: 16,
    paddingTop: layout.mainContentPaddingTop,
    flexGrow: 1,
  },
  centered: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 3 },
  unblockBtn: {
    minWidth: 84,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  disabledBtn: { opacity: 0.6 },
  unblockLabel: { fontSize: 13, fontWeight: '600' },
});
