import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { ensureProfileReady } from '@/lib/profileBootstrap';
import { getAuthProvider } from '@shared/entryState';

function getRecoveryCopy(state: string) {
  switch (state) {
    case 'suspected_fragmented_identity':
      return {
        title: 'Try the sign-in method you used before',
        description:
          'This sign-in may not match the account you previously used on Vibely. Try the method you used before to avoid creating a duplicate account.',
        primaryLabel: 'Try another sign-in method',
        secondaryLabel: 'Retry account check',
      };
    case 'missing_profile':
      return {
        title: "We couldn't finish setting up your account",
        description:
          'We could not verify your profile setup yet. Retry setup check or sign out and try signing in again.',
        primaryLabel: 'Retry setup check',
        secondaryLabel: 'Sign out',
      };
    case 'account_suspended':
      return {
        title: 'Account restricted',
        description:
          'This account has been suspended. Contact support if you think this is a mistake. You can sign out or check again after your account is restored.',
        primaryLabel: 'Check again',
        secondaryLabel: 'Sign out',
      };
    default:
      return {
        title: "We couldn't verify your account right now",
        description:
          'We could not verify your account state right now. Retry the check or sign out and try again.',
        primaryLabel: 'Retry',
        secondaryLabel: 'Sign out',
      };
  }
}

export default function EntryRecoveryScreen() {
  const theme = Colors[useColorScheme()];
  const { session, entryState, entryStateLoading, refreshEntryState, signOut } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const provider = getAuthProvider(session?.user);

  const recoveryState = entryState?.state ?? 'hard_error';
  const copy = useMemo(() => getRecoveryCopy(recoveryState), [recoveryState]);

  useEffect(() => {
    if (!session) {
      router.replace('/(auth)/sign-in');
      return;
    }
    if (!entryState) return;

    if (entryState.state === 'complete') {
      router.replace('/(tabs)');
      return;
    }
    if (entryState.state === 'incomplete') {
      router.replace('/(onboarding)');
      return;
    }

    trackEvent('entry_recovery_shown', {
      state: entryState.state,
      reason_code: entryState.reason_code,
      platform: 'native',
      provider,
      evaluation_version: entryState.evaluation_version,
    });
  }, [entryState, provider, session]);

  const handleRetry = async () => {
    if (!session?.user || isRetrying || isSigningOut) return;

    setIsRetrying(true);
    trackEvent('entry_recovery_retry_clicked', {
      state: entryState?.state ?? 'hard_error',
      reason_code: entryState?.reason_code ?? 'resolver_exception',
      platform: 'native',
      provider,
      evaluation_version: entryState?.evaluation_version ?? 1,
    });

    try {
      await ensureProfileReady(session.user, 'sign_in_screen_effect');
      const nextEntryState = await refreshEntryState();
      if (!nextEntryState) return;
      if (nextEntryState.state === 'complete') {
        router.replace('/(tabs)');
        return;
      }
      if (nextEntryState.state === 'incomplete') {
        router.replace('/(onboarding)');
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const handleTryAnotherMethod = async () => {
    if (isSigningOut || isRetrying) return;
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut || isRetrying) return;
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } finally {
      setIsSigningOut(false);
    }
  };

  if (entryStateLoading) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>{copy.title}</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>{copy.description}</Text>
        {recoveryState === 'suspected_fragmented_identity' ? (
          <>
            <VibelyButton
              label={isSigningOut ? 'Signing out...' : copy.primaryLabel}
              onPress={handleTryAnotherMethod}
              variant="gradient"
              disabled={isSigningOut || isRetrying}
            />
            <VibelyButton
              label={isRetrying ? 'Checking account...' : copy.secondaryLabel}
              onPress={handleRetry}
              variant="secondary"
              disabled={isRetrying || isSigningOut}
            />
          </>
        ) : (
          <>
            <VibelyButton
              label={isRetrying ? 'Checking account...' : copy.primaryLabel}
              onPress={handleRetry}
              variant="gradient"
              disabled={isRetrying || isSigningOut}
            />
            <VibelyButton
              label={isSigningOut ? 'Signing out...' : copy.secondaryLabel}
              onPress={handleSignOut}
              variant="secondary"
              disabled={isSigningOut || isRetrying}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
