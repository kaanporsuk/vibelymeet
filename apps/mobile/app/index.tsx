import { Redirect, type Href } from 'expo-router';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';

const ENTRY_RECOVERY_HREF = '/entry-recovery' as Href;

export default function Index() {
  const { session, loading, entryState, entryStateLoading } = useAuth();
  const colorScheme: 'light' | 'dark' = useColorScheme() === 'light' ? 'light' : 'dark';
  const themeColors = Colors[colorScheme];

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
