/**
 * Public profile — full parity via fetchUserProfile + UserProfileFullView + action footer.
 */
import React, { useState, useCallback } from 'react';
import { View, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';
import { useUserProfile } from '@/lib/useUserProfile';
import { UserProfileFullView } from '@/components/profile/UserProfileFullView';
import { ErrorState } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useMatches } from '@/lib/chatApi';
import { useUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { useVibelyDialog } from '@/components/VibelyDialog';

function paramToString(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return undefined;
}

export default function PublicProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const userId = paramToString(params.userId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { user } = useAuth();
  const { data: profile, isPending, isError } = useUserProfile(userId ?? null);
  const { data: matches = [] } = useMatches(user?.id);
  const matchRow = userId && user?.id ? matches.find((m) => m.id === userId) : null;
  const { mutateAsync: unmatch } = useUnmatch();
  const { blockUser, isUserBlocked } = useBlockUser(user?.id);
  const [showReport, setShowReport] = useState(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const handleUnmatch = useCallback(() => {
    if (!matchRow) return;
    showDialog({
      title: 'Unmatch?',
      message: `Remove ${profile?.name ?? 'this user'} from your matches? This can’t be undone.`,
      variant: 'destructive',
      primaryAction: {
        label: 'Unmatch',
        onPress: () => {
          void (async () => {
            try {
              await unmatch({ matchId: matchRow.matchId });
              router.back();
            } catch (err) {
              if (__DEV__) console.warn('[UserProfile] unmatch failed:', err);
              showDialog({
                title: 'Unmatch didn’t go through',
                message: 'Something went wrong. Please try again.',
                variant: 'warning',
                primaryAction: { label: 'OK', onPress: () => {} },
              });
            }
          })();
        },
      },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  }, [matchRow, profile?.name, unmatch, router, showDialog]);

  const handleBlock = useCallback(() => {
    if (!userId) return;
    const displayName = profile?.name || 'this user';
    showDialog({
      title: 'Block this person?',
      message: `${displayName} won’t be able to contact you or see your profile.`,
      variant: 'destructive',
      primaryAction: {
        label: 'Block',
        onPress: () => {
          void (async () => {
            try {
              await blockUser({ blockedId: userId, matchId: matchRow?.matchId });
              router.back();
            } catch (err) {
              if (__DEV__) console.warn('[UserProfile] block failed:', err);
              showDialog({
                title: 'Block didn’t go through',
                message: 'Something went wrong. Please try again.',
                variant: 'warning',
                primaryAction: { label: 'OK', onPress: () => {} },
              });
            }
          })();
        },
      },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  }, [userId, profile?.name, matchRow?.matchId, blockUser, router, showDialog]);

  if (!userId) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        {dialogEl}
        <ErrorState
          title="Invalid profile"
          message="User not found."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (isPending || (profile == null && !isError)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        {dialogEl}
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        {dialogEl}
        <ErrorState
          title="Could not load this profile."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {dialogEl}
      <UserProfileFullView profile={profile} isOwnProfile={false} onClose={() => router.back()} />

      {user?.id && userId && !isUserBlocked(userId) ? (
        <View
          style={[
            styles.actionFooter,
            {
              paddingBottom: insets.bottom + 12,
              backgroundColor: 'rgba(13,13,18,0.95)',
              borderTopColor: 'rgba(255,255,255,0.06)',
            },
          ]}
        >
          {matchRow ? (
            <Pressable onPress={() => router.push(`/chat/${userId}`)} style={styles.actionBtn}>
              <Ionicons name="chatbubble-outline" size={20} color="#8B5CF6" />
              <Text style={[styles.actionLabel, { color: theme.text }]}>Message</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setShowReport(true)} style={styles.actionBtn}>
            <Ionicons name="flag-outline" size={20} color={theme.textSecondary} />
            <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>Report</Text>
          </Pressable>
          <Pressable onPress={handleBlock} style={styles.actionBtn}>
            <Ionicons name="ban-outline" size={20} color="#E24B4A" />
            <Text style={[styles.actionLabel, { color: '#E24B4A' }]}>Block</Text>
          </Pressable>
          {matchRow ? (
            <Pressable onPress={handleUnmatch} style={styles.actionBtn}>
              <Ionicons name="person-remove-outline" size={20} color="#E24B4A" />
              <Text style={[styles.actionLabel, { color: '#E24B4A' }]}>Unmatch</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {user?.id && showReport && userId ? (
        <ReportFlowModal
          visible={showReport}
          onClose={() => setShowReport(false)}
          onSuccess={() => {
            setShowReport(false);
            router.back();
          }}
          reportedId={userId}
          reportedName={profile?.name ?? 'User'}
          reporterId={user.id}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
