import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { session, loading, onboardingComplete } = useAuth();

  if (loading) return null;

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  // Wait for onboarding resolution so we don't flash tabs for users who need onboarding
  if (onboardingComplete === null) return null;
  if (onboardingComplete === false) {
    return <Redirect href="/(onboarding)" />;
  }
  return <Redirect href="/(tabs)" />;
}
