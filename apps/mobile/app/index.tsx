import { Redirect, type Href } from 'expo-router';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

const ENTRY_RECOVERY_HREF = '/entry-recovery' as Href;

export default function Index() {
  const { session, loading, entryState, entryStateLoading } = useAuth();
  const colorScheme: 'light' | 'dark' = useColorScheme() === 'light' ? 'light' : 'dark';
  const themeColors = Colors[colorScheme];
  const bootLogKey = useRef<string | null>(null);

  useEffect(() => {
    if (loading || entryStateLoading) return;
    const key = !session
      ? 'no_session'
      : !entryState
        ? 'no_entry'
        : entryState.state;
    if (bootLogKey.current === key) return;
    bootLogKey.current = key;
    let target: string;
    if (!session) target = 'sign-in';
    else if (!entryState) target = 'entry-recovery';
    else if (entryState.state === 'complete') target = 'tabs';
    else if (entryState.state === 'incomplete') target = 'onboarding';
    else target = 'entry-recovery';
    rcBreadcrumb(RC_CATEGORY.authBoot, 'index_boot_route', {
      target,
      entry_state: entryState?.state ?? null,
      reason_code: entryState?.reason_code ?? null,
    });
  }, [loading, entryStateLoading, session, entryState]);

  if (loading || entryStateLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.background }}>
        <ActivityIndicator size="large" color={themeColors.tint} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!entryState) {
    return <Redirect href={ENTRY_RECOVERY_HREF} />;
  }

  if (entryState.state === 'complete') {
    return <Redirect href="/(tabs)" />;
  }

  if (entryState.state === 'incomplete') {
    return <Redirect href="/(onboarding)" />;
  }

  return <Redirect href={ENTRY_RECOVERY_HREF} />;
}
