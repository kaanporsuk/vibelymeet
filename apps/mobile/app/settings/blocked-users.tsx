/**
 * Blocked users — list from blocked_users + profiles; unblock via useBlockUser.
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useBlockUser } from '@/lib/useBlockUser';
import { avatarUrl } from '@/lib/imageUrl';

export default function BlockedUsersScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { blockedUsers, unblockUser, isBlockedUsersLoading, isUnblocking } = useBlockUser(user?.id);

  const blockedIds = useMemo(() => blockedUsers.map((b) => b.blocked_id), [blockedUsers]);

  const { data: profiles = [], isLoading: isProfilesLoading } = useQuery({
    queryKey: ['blocked-user-profiles', user?.id, blockedIds],
    queryFn: async () => {
      if (!blockedIds.length) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, photos')
        .in('id', blockedIds);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string | null;
        avatar_url: string | null;
        photos: string[] | null;
      }[];
    },
    enabled: !!user?.id && blockedIds.length > 0,
  });

  const profileById = useMemo(() => {
    const m = new Map<string, (typeof profiles)[0]>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const listLoading = isBlockedUsersLoading || (blockedIds.length > 0 && isProfilesLoading);

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
      >
        {listLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.tint} size="large" />
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
              const p = profileById.get(block.blocked_id);
              const rawPhoto = p?.avatar_url ?? p?.photos?.[0] ?? null;
              const uri = avatarUrl(rawPhoto, 'avatar');
              const name = p?.name?.trim() || 'Member';
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
                  </View>
                  <Pressable
                    onPress={() => unblockUser({ blockedId: block.blocked_id })}
                    disabled={isUnblocking}
                    style={({ pressed }) => [
                      styles.unblockBtn,
                      { borderColor: theme.border },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.unblockLabel, { color: theme.tint }]}>Unblock</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
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
  unblockBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  unblockLabel: { fontSize: 13, fontWeight: '600' },
});
