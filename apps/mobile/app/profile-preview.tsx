import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { View } from '@/components/Themed';
import { LoadingState, ErrorState } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useUserProfile } from '@/lib/useUserProfile';
import { UserProfileFullView } from '@/components/profile/UserProfileFullView';

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const theme = Colors[useColorScheme()];
  const profileId = user?.id ?? null;
  const { data: profile, isPending, isError, error, refetch } = useUserProfile(profileId);
  const [hasFreshPreview, setHasFreshPreview] = useState(false);
  const [freshPreviewFailed, setFreshPreviewFailed] = useState(false);
  const refetchRequestIdRef = useRef(0);

  const retry = useCallback(() => {
    const requestId = refetchRequestIdRef.current + 1;
    refetchRequestIdRef.current = requestId;
    setHasFreshPreview(false);
    setFreshPreviewFailed(false);
    if (!profileId) return;
    void refetch()
      .then((result) => {
        if (refetchRequestIdRef.current !== requestId) return;
        setFreshPreviewFailed(result.isError || result.data?.id !== profileId);
        setHasFreshPreview(true);
      })
      .catch((e) => {
        if (refetchRequestIdRef.current !== requestId) return;
        setFreshPreviewFailed(true);
        setHasFreshPreview(true);
        if (__DEV__) console.warn('[profile-preview] refetch failed:', e);
      });
  }, [profileId, refetch]);

  useFocusEffect(
    useCallback(() => {
      retry();
      return () => {
        refetchRequestIdRef.current += 1;
      };
    }, [retry]),
  );

  const centered = {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: theme.background,
  };

  if (!profileId) {
    return (
      <View style={[centered, { flex: 1 }]}>
        <ErrorState
          title="Sign in required"
          message="Log in to preview your public profile."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (isPending || !hasFreshPreview) {
    return (
      <View style={centered}>
        <LoadingState title="Loading preview..." message="Just a sec..." />
      </View>
    );
  }

  if (freshPreviewFailed || (isError && !profile) || !profile) {
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

  return <UserProfileFullView profile={profile} isOwnProfile={false} onClose={() => router.back()} />;
}
