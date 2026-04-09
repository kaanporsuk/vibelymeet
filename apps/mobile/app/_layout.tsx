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
import { Redirect, Stack, router, usePathname, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { DeactivatedAccountReactivationPrompt } from '@/components/DeactivatedAccountReactivationPrompt';
import { ActivityIndicator, LogBox, View } from 'react-native';
import { useGlobalMessagesInboxInvalidation } from '@/lib/chatApi';
import { useRealtimeEvents } from '@/lib/useRealtimeEvents';
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
import { identifyUser, resetAnalytics, setPostHogClient, setUserProperties } from '@/lib/analytics';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { initRevenueCat, isRevenueCatConfigured, setRevenueCatUserId } from '@/lib/revenuecat';
import { useActivityHeartbeat } from '@/lib/useActivityHeartbeat';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { initStreamCdnHostname } from '@/lib/vibeVideoPlaybackUrl';
import { ChatOutboxProvider } from '@/lib/chatOutbox/ChatOutboxContext';
import { ChatOutboxRunner } from '@/lib/chatOutbox/ChatOutboxRunner';
import { supabase } from '@/lib/supabase';
import { completeSessionFromAuthReturnUrl } from '@/lib/nativeAuthRedirect';
import { applyNativeReferralAttribution, captureNativeReferral } from '@/lib/referrals';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

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

// Wire the module-level native hero upload controller to the query client so it
// can invalidate ['my-profile'] after upload/processing completes — even when no
// screen is mounted.
import('@/lib/nativeHeroVideoUploadController').then(({ nativeHeroVideoSetQueryClient }) => {
  nativeHeroVideoSetQueryClient(queryClient);
});

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

/**
 * PostHog: client wiring, auth identity, and screen views.
 * Parity with web `useAppBootstrap` (identify on session user id + reset when logged out).
 */
function PostHogScreenTracker() {
  const pathname = usePathname();
  const posthog = usePostHog();
  const { user, loading: authLoading } = useAuth();
  const { tierId, isLoading: entLoading } = useEntitlements();
  const { isPremium, isLoading: subLoading } = useBackendSubscription(user?.id);

  useEffect(() => {
    if (posthog) setPostHogClient(posthog);
    if (!posthog) return;
    // Avoid reset/identify while session is still hydrating (cold start).
    if (authLoading) return;
    if (!user?.id) {
      resetAnalytics();
      return;
    }
    identifyUser(user.id, {
      email: user.email ?? null,
      created_at: user.created_at ?? null,
    });
  }, [posthog, authLoading, user?.id, user?.email, user?.created_at]);

  // Premium person props — parity with web `useAppBootstrap` → PostHog `is_premium` + `subscription_tier`.
  useEffect(() => {
    if (!posthog || authLoading || !user?.id) return;
    if (entLoading || subLoading) return;
    setUserProperties({
      is_premium: isPremium,
      subscription_tier: tierId,
    });
  }, [posthog, authLoading, user?.id, entLoading, subLoading, isPremium, tierId]);

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

/** Events + event_registrations postgres_changes → TanStack invalidation (web `useRealtimeEvents` parity). */
function EventsRealtimeUpdater() {
  const { user } = useAuth();
  useRealtimeEvents(user?.id);
  return null;
}

function AuthRedirectHandler({ onReferralCaptured }: { onReferralCaptured: () => void }) {
  const lastHandledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleIncomingUrl = async (url: string | null | undefined) => {
      if (!url || cancelled || lastHandledUrlRef.current === url) return;

      const referralId = await captureNativeReferral(url);
      if (referralId) {
        onReferralCaptured();
      }

      const result = await completeSessionFromAuthReturnUrl(supabase, url);
      if (cancelled || !result.handled) return;

      lastHandledUrlRef.current = url;

      rcBreadcrumb(RC_CATEGORY.authRedirectUrl, 'auth_return_url', {
        recovery: result.recovery,
        recovery_status: result.recoveryStatus,
        has_error: Boolean(result.error),
        error_snippet: result.error ? String(result.error.message).slice(0, 120) : null,
      });

      if (__DEV__ && result.error) {
        console.warn('[auth-link] session hydration failed:', result.error.message);
      }

      if (result.recovery) {
        router.replace(
          result.error
            ? {
                pathname: '/(auth)/reset-password',
                params: {
                  authError: result.error.message,
                  recovery: result.recoveryStatus,
                },
              }
            : {
                pathname: '/(auth)/reset-password',
                params: { recovery: result.recoveryStatus },
              },
        );
        return;
      }

      if (result.error) {
        router.replace({
          pathname: '/(auth)/sign-in',
          params: { authError: result.error.message },
        });
        return;
      }

      router.replace('/');
    };

    void Linking.getInitialURL().then((url) => handleIncomingUrl(url));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [onReferralCaptured]);

  return null;
}

const PROTECTED_ROOT_SEGMENTS = new Set([
  '(tabs)',
  'event',
  'chat',
  'daily-drop',
  'ready',
  'date',
  'settings',
  'premium',
  'vibe-studio',
  'vibe-video-record',
  'user',
  'schedule',
  'subscription-success',
  'subscription-cancel',
  'credits-success',
  'event-payment-success',
  'how-it-works',
  'delete-account',
]);

function ReferralAttributionSync({ syncTick }: { syncTick: number }) {
  const { session, entryState } = useAuth();
  const lastAttemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user?.id ?? null;
    const entryStateKey =
      entryState?.state === 'complete' || entryState?.state === 'incomplete'
        ? entryState.state
        : null;

    if (!userId || !entryStateKey) {
      return;
    }

    const attemptKey = `${userId}:${entryStateKey}:${syncTick}`;
    if (lastAttemptKeyRef.current === attemptKey) return;
    lastAttemptKeyRef.current = attemptKey;

    let cancelled = false;
    void applyNativeReferralAttribution(userId).then((result) => {
      if (cancelled || result.status !== 'rpc-failed') return;
      console.warn('[referrals] native attribution failed', {
        userId,
        status: result.status,
        message: result.message,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, entryState?.state, syncTick]);

  return null;
}

function EntryStateRouteGate({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const { session, loading, entryState, entryStateLoading } = useAuth();
  const rootSegment = segments[0] ?? null;
  const isProtectedRoute = rootSegment != null && PROTECTED_ROOT_SEGMENTS.has(rootSegment);

  if (!isProtectedRoute) {
    return <>{children}</>;
  }

  if (loading || entryStateLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!entryState) {
    return <Redirect href="/entry-recovery" />;
  }

  if (entryState.state === 'incomplete') {
    return <Redirect href="/(onboarding)" />;
  }

  if (entryState.state !== 'complete') {
    return <Redirect href="/entry-recovery" />;
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  useCurrentRouteTracker();
  const [, setCdnHostInitTick] = useState(0);
  const [referralSyncTick, setReferralSyncTick] = useState(0);

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
        <Stack.Screen name="vibe-studio" options={{ headerShown: false, title: 'Vibe Studio' }} />
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
  const gatedStack = <EntryStateRouteGate>{stack}</EntryStateRouteGate>;

  const navContent = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ChatOutboxProvider>
        <AuthRedirectHandler onReferralCaptured={() => setReferralSyncTick((t) => t + 1)} />
        <ReferralAttributionSync syncTick={referralSyncTick} />
        <PushRegistration />
        <NotificationRouteTracker />
        <NotificationDeepLinkHandler />
        <NotificationPauseForeground />
        <DeactivatedAccountReactivationPrompt />
        <ActivityHeartbeat />
        <RevenueCatUserSync />
        <BadgeCountUpdater />
        <EventsRealtimeUpdater />
        <ChatOutboxRunner />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {POSTHOG_ENABLED ? (
              <PostHogProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
                <PostHogScreenTracker />
                {gatedStack}
              </PostHogProvider>
            ) : (
              gatedStack
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
