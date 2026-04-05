import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import * as Sentry from '@sentry/react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { DeactivatedAccountReactivationPrompt } from '@/components/DeactivatedAccountReactivationPrompt';
import { LogBox, View } from 'react-native';
import { useGlobalMessagesInboxInvalidation } from '@/lib/chatApi';
import { useBadgeCount } from '@/lib/useBadgeCount';
import { useCurrentRouteTracker } from '@/lib/useCurrentRoute';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { PushRegistration } from '@/components/PushRegistration';
import { NotificationDeepLinkHandler, NotificationRouteTracker } from '@/components/NotificationDeepLinkHandler';
import { NotificationPauseForeground } from '@/components/NotificationPauseForeground';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OfflineBanner } from '@/components/connectivity/OfflineBanner';
import { connectivityService } from '@/lib/connectivityService';
import { setPostHogClient } from '@/lib/analytics';
import { initRevenueCat, isRevenueCatConfigured, setRevenueCatUserId } from '@/lib/revenuecat';
import { useActivityHeartbeat } from '@/lib/useActivityHeartbeat';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { initStreamCdnHostname } from '@/lib/vibeVideoPlaybackUrl';
import { ChatOutboxProvider } from '@/lib/chatOutbox/ChatOutboxContext';
import { ChatOutboxRunner } from '@/lib/chatOutbox/ChatOutboxRunner';
import { supabase } from '@/lib/supabase';
import { completeSessionFromAuthReturnUrl } from '@/lib/nativeAuthRedirect';

// ─── Sentry (matches web src/main.tsx)
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: 0.2,
    beforeSend(event) {
      if (event.user) {
        delete (event.user as Record<string, unknown>).email;
        delete (event.user as Record<string, unknown>).ip_address;
      }
      return event;
    },
  });
}

// ─── PostHog (matches web src/main.tsx)
const POSTHOG_KEY = (process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '').trim();
const POSTHOG_HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com').trim();
const POSTHOG_DEV_ENABLED = (process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED ?? '').trim().toLowerCase() === 'true';
const POSTHOG_HOST_VALID = /^https?:\/\/\S+$/i.test(POSTHOG_HOST);
const POSTHOG_ENABLED = Boolean(POSTHOG_KEY) && POSTHOG_HOST_VALID && (!__DEV__ || POSTHOG_DEV_ENABLED);

if (__DEV__) {
  LogBox.ignoreLogs([
    'RevenueCat',
    'configuration is not valid',
    'offering',
    'has no packages',
    'packages configured',
  ]);
}

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

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    // Vibely body text (web: Inter)
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Vibely headings/display (web: Space Grotesk)
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
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

  // Keep splash visible until fonts are loaded (or error)
  if (!loaded && !error) {
    return null;
  }

  return <RootLayoutNav />;
}

/** Track screen views in PostHog (matches web PostHogPageTracker). */
function PostHogScreenTracker() {
  const pathname = usePathname();
  const posthog = usePostHog();

  useEffect(() => {
    if (posthog) setPostHogClient(posthog);
  }, [posthog]);

  useEffect(() => {
    if (pathname && posthog) {
      posthog.capture('$screen', { $screen_name: pathname });
    }
  }, [pathname, posthog]);

  return null;
}

/** Binds RevenueCat app user id to Supabase auth id (restore/purchases need this before opening Premium). */
function RevenueCatUserSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (user?.id && isRevenueCatConfigured()) {
      void setRevenueCatUserId(user.id);
    }
  }, [user?.id]);
  return null;
}

/** Updates profiles.last_seen_at every 60s while app is in foreground — skipped when on a break. */
function ActivityHeartbeat() {
  const { user } = useAuth();
  const { isPaused } = useAccountPauseStatus();
  useActivityHeartbeat(user?.id ?? null, isPaused);
  return null;
}

/** Realtime invalidation for tab unread + combined badge query; badge hook runs the actual counts. */
function BadgeCountUpdater() {
  const { user } = useAuth();
  useGlobalMessagesInboxInvalidation(user?.id);
  useBadgeCount();
  return null;
}

function AuthRedirectHandler() {
  const lastHandledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleIncomingUrl = async (url: string | null | undefined) => {
      if (!url || cancelled || lastHandledUrlRef.current === url) return;

      const result = await completeSessionFromAuthReturnUrl(supabase, url);
      if (cancelled || !result.handled) return;

      lastHandledUrlRef.current = url;

      if (__DEV__ && result.error) {
        console.warn('[auth-link] session hydration failed:', result.error.message);
      }

      if (result.recovery) {
        router.replace('/(auth)/reset-password');
        return;
      }

      if (!result.error) {
        router.replace('/');
      }
    };

    void Linking.getInitialURL().then((url) => handleIncomingUrl(url));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  useCurrentRouteTracker();
  const [, setCdnHostInitTick] = useState(0);

  useEffect(() => {
    initRevenueCat();
    connectivityService.init();
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    // Keep analytics wrappers safe and quiet when PostHog is disabled.
    if (!POSTHOG_ENABLED) {
      setPostHogClient(null);
    }
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (POSTHOG_KEY && !POSTHOG_HOST_VALID) {
      console.warn('[Vibely] PostHog disabled: EXPO_PUBLIC_POSTHOG_HOST must be a valid http(s) URL.');
      return;
    }
    if (POSTHOG_KEY && !POSTHOG_DEV_ENABLED) {
      console.log('[Vibely] PostHog disabled in dev. Set EXPO_PUBLIC_POSTHOG_DEV_ENABLED=true to opt in.');
    }
  }, []);

  useEffect(() => {
    void initStreamCdnHostname().then(() => setCdnHostInitTick((t) => t + 1));
  }, []);

  const stack = (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="entry-recovery" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[eventId]/lobby" options={{ headerShown: false, title: 'Event Lobby' }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false, title: 'Chat' }} />
        <Stack.Screen name="daily-drop" options={{ headerShown: false, title: 'Daily Drop' }} />
        <Stack.Screen name="ready/[id]" options={{ headerShown: false, title: 'Ready Gate' }} />
        <Stack.Screen name="date/[id]" options={{ headerShown: false, title: 'Video Date' }} />
        <Stack.Screen name="settings" options={{ headerShown: false, title: 'Settings' }} />
        <Stack.Screen name="premium" options={{ headerShown: false, title: 'Premium' }} />
        <Stack.Screen name="vibe-video-record" options={{ headerShown: false, title: 'Record Vibe Video' }} />
        <Stack.Screen name="user/[userId]" options={{ headerShown: false, title: 'Profile' }} />
        <Stack.Screen name="schedule" options={{ headerShown: false, title: 'Schedule' }} />
        <Stack.Screen name="subscription-success" options={{ headerShown: false, title: 'Success' }} />
        <Stack.Screen name="subscription-cancel" options={{ title: 'Cancelled', headerShown: false }} />
        <Stack.Screen name="credits-success" options={{ headerShown: false, title: 'Success' }} />
        <Stack.Screen name="event-payment-success" options={{ headerShown: false, title: 'Success' }} />
        <Stack.Screen name="how-it-works" options={{ headerShown: false, title: 'How It Works' }} />
      </Stack>
    </ThemeProvider>
  );

  const navContent = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ChatOutboxProvider>
        <AuthRedirectHandler />
        <PushRegistration />
        <NotificationRouteTracker />
        <NotificationDeepLinkHandler />
        <NotificationPauseForeground />
        <DeactivatedAccountReactivationPrompt />
        <ActivityHeartbeat />
        <RevenueCatUserSync />
        <BadgeCountUpdater />
        <ChatOutboxRunner />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {POSTHOG_ENABLED ? (
              <PostHogProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
                <PostHogScreenTracker />
                {stack}
              </PostHogProvider>
            ) : (
              stack
            )}
          </View>
          <OfflineBanner />
        </View>
        </ChatOutboxProvider>
      </AuthProvider>
    </QueryClientProvider>
  );

  return navContent;
}

export default Sentry.wrap(RootLayout);
