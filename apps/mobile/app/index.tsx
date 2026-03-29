import { Redirect } from 'expo-router';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';

export default function Index() {
  const { session, loading, onboardingComplete } = useAuth();
  const colorScheme: 'light' | 'dark' = useColorScheme() === 'light' ? 'light' : 'dark';
  const themeColors = Colors[colorScheme];

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

  if (onboardingComplete === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.background }}>
        <ActivityIndicator size="large" color={themeColors.tint} />
      </View>
    );
  }
  if (onboardingComplete === false) {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(tabs)" />;
}
