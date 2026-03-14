import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { PushRegistration } from '@/components/PushRegistration';

if (__DEV__) {
  LogBox.ignoreLogs([
    'RevenueCat',
    'configuration is not valid',
    'offering',
    'has no packages',
    'packages configured',
  ]);
}
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
// Guard so preview/standalone never crashes on splash init or unhandled rejection.
try {
  SplashScreen.preventAutoHideAsync()?.catch(() => {});
} catch {
  // no-op: allow app to continue if native splash module fails
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Do not throw on font error: in preview/production builds font loading can fail
  // (e.g. EAS bundling); throwing would crash the app after the launch screen.
  useEffect(() => {
    if (error && __DEV__) {
      console.warn('[Vibely] Font load failed, using system font:', error?.message ?? error);
    }
  }, [error]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync()?.catch(() => {});
    }
  }, [loaded, error]);

  if (!loaded && !error) {
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
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: true }} />
          <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="event/[eventId]/lobby" options={{ headerShown: false, title: 'Event Lobby' }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false, title: 'Chat' }} />
          <Stack.Screen name="daily-drop" options={{ headerShown: false, title: 'Daily Drop' }} />
          <Stack.Screen name="ready/[id]" options={{ headerShown: false, title: 'Ready Gate' }} />
          <Stack.Screen name="date/[id]" options={{ headerShown: false, title: 'Video Date' }} />
          <Stack.Screen name="settings" options={{ headerShown: false, title: 'Settings' }} />
          <Stack.Screen name="premium" options={{ headerShown: false, title: 'Premium' }} />
        </Stack>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
