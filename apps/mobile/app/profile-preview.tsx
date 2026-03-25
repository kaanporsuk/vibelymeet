import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { View } from '@/components/Themed';
import { LoadingState, ErrorState } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile } from '@/lib/profileApi';
import { profileRowToUserProfileView } from '@/lib/fetchUserProfile';
import { UserProfileFullView } from '@/components/profile/UserProfileFullView';

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const theme = Colors[useColorScheme()];
  const { data: profile, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });
  const retry = useCallback(() => {
    void refetch().catch((e) => {
      if (__DEV__) console.warn('[profile-preview] refetch failed:', e);
    });
  }, [refetch]);
  useFocusEffect(
    useCallback(() => {
      if (user?.id) retry();
    }, [user?.id, retry]),
  );
  const centered = {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: theme.background,
  };
  if (isLoading && !profile) {
    return (
      <View style={centered}>
        <LoadingState title="Loading preview…" message="Just a sec…" />
      </View>
    );
  }
  if ((isError && !profile) || (!isLoading && user?.id && !profile)) {
    const msg =
      isError && !profile
        ? error instanceof Error
          ? error.message
          : "Couldn't load profile."
        : "We couldn't load your profile. Check your connection and try again.";
    return (
      <View style={[centered, { flex: 1 }]}>
        <ErrorState message={msg} onActionPress={retry} />
      </View>
    );
  }
  if (!profile) {
    return (
      <View style={[centered, { flex: 1 }]}>
        <ErrorState
          title="Sign in required"
          message="Log in to preview your profile."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }
  return (
    <UserProfileFullView
      profile={profileRowToUserProfileView(profile)}
      isOwnProfile
      onEditProfile={() => router.back()}
      onClose={() => router.back()}
    />
  );
}
