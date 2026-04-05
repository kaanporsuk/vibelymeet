import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, useColorScheme, StyleSheet } from 'react-native';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';
import { VibelyButton } from '@/components/ui';

export default function Index() {
  const { session, loading, onboardingStatus, profilePresence, refreshOnboarding, signOut } = useAuth();
  const colorScheme: 'light' | 'dark' = useColorScheme() === 'light' ? 'light' : 'dark';
  const themeColors = Colors[colorScheme];
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleRetry = async () => {
    if (isRetrying || isSigningOut) return;
    setIsRetrying(true);
    try {
      await refreshOnboarding();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut || isRetrying) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.background }}>
        <ActivityIndicator size="large" color={themeColors.tint} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (onboardingStatus === 'unknown') {
    const message =
      profilePresence === 'missing'
        ? 'We could not verify your profile setup. Retry setup check or sign out and sign in again.'
        : 'We could not verify your account setup right now. Retry setup check or sign out and sign in again.';

    return (
      <View style={[styles.recoveryRoot, { backgroundColor: themeColors.background }]}>
        <View style={[styles.recoveryCard, { backgroundColor: themeColors.surfaceSubtle, borderColor: themeColors.border }]}> 
          <Text style={[styles.recoveryTitle, { color: themeColors.text }]}>Account setup check required</Text>
          <Text style={[styles.recoveryMessage, { color: themeColors.textSecondary }]}>{message}</Text>
          <VibelyButton
            label={isRetrying ? 'Checking setup…' : 'Retry setup check'}
            onPress={handleRetry}
            variant="gradient"
            disabled={isRetrying || isSigningOut}
          />
          <VibelyButton
            label={isSigningOut ? 'Signing out…' : 'Sign out'}
            onPress={handleSignOut}
            variant="secondary"
            disabled={isSigningOut || isRetrying}
          />
        </View>
      </View>
    );
  }
  if (onboardingStatus === 'incomplete') {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  recoveryRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  recoveryCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  recoveryTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  recoveryMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
