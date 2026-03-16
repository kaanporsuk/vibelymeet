import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';

export default function Index() {
  const { session, loading, onboardingComplete } = useAuth();

  if (loading || onboardingComplete === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dark.background }}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (onboardingComplete === false) {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(tabs)" />;
}
