import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';

// Suppress RevenueCat SDK LogBox when offerings are missing/empty in dev (dashboard not yet configured).
LogBox.ignoreLogs([
  'RevenueCat',
  'configuration is not valid',
  'offering',
  'has no packages',
  'packages configured',
]);
import { PushRegistration } from '@/components/PushRegistration';
import { AuthProvider } from '@/context/AuthContext';
import { initRevenueCat } from '@/lib/revenuecat';

const queryClient = new QueryClient();

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    initRevenueCat();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PushRegistration />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ headerShown: true }} />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="event/[eventId]/lobby" options={{ title: 'Event Lobby' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="daily-drop" options={{ title: 'Daily Drop' }} />
          <Stack.Screen name="ready/[id]" options={{ title: 'Ready Gate' }} />
          <Stack.Screen name="date/[id]" options={{ title: 'Video Date' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="premium" options={{ title: 'Premium' }} />
        </Stack>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
