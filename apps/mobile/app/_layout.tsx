// Must stay before every other import so `globalThis.crypto.getRandomValues` exists
// before auth helpers run and Apple nonce generation never falls back to a missing native module.
import 'react-native-get-random-values';

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
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { shouldRunMediaSdkForegroundReconcile } from '@clientShared/media-sdk';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Redirect, Stack, router, usePathname, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { DeactivatedAccountReactivationPrompt } from '@/components/DeactivatedAccountReactivationPrompt';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, type AppStateStatus, LogBox, View } from 'react-native';
import { useGlobalMessagesInboxInvalidation } from '@/lib/chatApi';
import { useProfileCountsRealtime } from '@/lib/useProfileCountsRealtime';
import { useRealtimeEvents } from '@/lib/useRealtimeEvents';
import { useBadgeCount } from '@/lib/useBadgeCount';
import { useCurrentRouteTracker } from '@/lib/useCurrentRoute';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { PushRegistration } from '@/components/PushRegistration';
import { NotificationDeepLinkHandler, NotificationRouteTracker } from '@/components/NotificationDeepLinkHandler';
import { NativeSessionRouteHydration } from '@/components/NativeSessionRouteHydration';
import { NotificationPauseForeground } from '@/components/NotificationPauseForeground';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { EntitlementsProvider } from '@/context/EntitlementsContext';
import { SessionHydrationProvider } from '@/context/SessionHydrationContext';
import { OfflineBanner } from '@/components/connectivity/OfflineBanner';
import { connectivityService } from '@/lib/connectivityService';
import { identifyUser, resetAnalytics, screen, setPostHogClient, setUserProperties } from '@/lib/analytics';
import { hydrateRuntimeAnalyticsConsent, subscribeNativeAnalyticsConsent } from '@/lib/analyticsConsent';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { initRevenueCat, isRevenueCatConfigured, setRevenueCatUserId } from '@/lib/revenuecat';
import { useActivityHeartbeat } from '@/lib/useActivityHeartbeat';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { initStreamCdnHostname } from '@/lib/vibeVideoPlaybackUrl';
import { pruneDuplicateRealtimeChannels } from '@/lib/realtimeLifecycle';
import { ChatOutboxProvider, useChatOutbox } from '@/lib/chatOutbox/ChatOutboxContext';
import { ChatOutboxRunner } from '@/lib/chatOutbox/ChatOutboxRunner';
import { PostDateOutboxRunner } from '@/lib/postDateOutbox/PostDateOutboxRunner';
import { MatchCallProvider } from '@/lib/useMatchCall';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';
import {
  selectPrimaryRecoveryAttentionTarget,
  uploadAttentionTargetIdentity,
} from '@clientShared/chat/uploadAttentionTargets';
import { completeSessionFromAuthReturnUrl } from '@/lib/nativeAuthRedirect';
import { applyNativeReferralAttribution, captureNativeReferral } from '@/lib/referrals';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { queryClient } from '@/lib/queryClient';
import {
  AUTH_REFRESH_LEAD_MS,
  AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS,
  applyManagedAuthRefreshSession,
  authRefreshDebugInfo,
  classifyAuthRefreshError,
  isNewerAuthRefreshSession,
  nextAuthRefreshDelayMs,
  requestManagedAuthRefresh,
  shouldRefreshSessionSoon,
} from '@clientShared/authRefreshPolicy';
import { invalidateCachedSession, primeCachedSession } from '@/lib/nativeAuthSession';
import { recoverNativeAuthSession } from '@/lib/nativeAuthRecovery';

// ─── Sentry (matches web src/main.tsx)
const SENSITIVE_SENTRY_KEY_PATTERN = /(authorization|cookie|password|secret|token|jwt|email|phone|ip_address|access_token|refresh_token)/i;
type NativeSentryMutableEvent = Record<string, unknown> & {
  breadcrumbs?: unknown;
  contexts?: unknown;
  exception?: { values?: Array<Record<string, unknown>> };
  extra?: unknown;
  request?: Record<string, unknown>;
};

function sanitizeNativeSentryText(value: string, maxLength = 500): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .slice(0, maxLength);
}

function sanitizeNativeSentryUrl(value: unknown): string | unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    if (parsed.origin === 'null') {
      const host = parsed.host ? `//${parsed.host}` : '';
      return `${parsed.protocol}${host}${parsed.pathname}`;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return sanitizeNativeSentryText(value);
  }
}

function sanitizeNativeSentryPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[redacted-depth]';
  if (typeof value === 'string') return sanitizeNativeSentryText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeNativeSentryPayload(entry, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
    if (SENSITIVE_SENTRY_KEY_PATTERN.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (typeof entry === 'string' && /^(url|filename|abs_path|request_url)$/i.test(key)) {
      output[key] = sanitizeNativeSentryUrl(entry);
      continue;
    }
    output[key] = sanitizeNativeSentryPayload(entry, depth + 1);
  }
  return output;
}

function sanitizeNativeSentryEvent(event: NativeSentryMutableEvent): NativeSentryMutableEvent {
  const request = event.request;
  if (request) {
    request.url = sanitizeNativeSentryUrl(request.url);
    delete request.headers;
    delete request.cookies;
    delete request.data;
    delete request.query_string;
  }

  event.extra = sanitizeNativeSentryPayload(event.extra);
  event.contexts = sanitizeNativeSentryPayload(event.contexts);
  event.breadcrumbs = sanitizeNativeSentryPayload(event.breadcrumbs);

  const exception = event.exception;
  if (exception?.values) {
    exception.values = exception.values.map((entry) => (
      sanitizeNativeSentryPayload(entry) as Record<string, unknown>
    ));
  }

  return event;
}

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
      return sanitizeNativeSentryEvent(event as unknown as NativeSentryMutableEvent) as unknown as typeof event;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // Metro font asset; require() is the supported API for useFonts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- TTF asset bundling
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
      screen(pathname);
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

function NativeUploadRecoveryGlobalBanner({ theme }: { theme: typeof Colors.dark }) {
  const { recoveryAttentionTargets } = useChatOutbox();
  const pathname = usePathname();
  const [hiddenAttentionTarget, setHiddenAttentionTarget] = useState<{
    identity: string;
    otherUserId: string | null;
  } | null>(null);
  const currentOtherUserId = useMemo(() => {
    const match = pathname.match(/^\/chat\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [pathname]);
  const shouldSuppressHiddenTarget = Boolean(
    hiddenAttentionTarget &&
      (hiddenAttentionTarget.otherUserId
        ? hiddenAttentionTarget.otherUserId === currentOtherUserId
        : currentOtherUserId === null),
  );
  const suppressedAttentionIdentity = shouldSuppressHiddenTarget
    ? hiddenAttentionTarget?.identity ?? ''
    : '';
  const visibleRecoveryAttentionTargets = useMemo(
    () =>
      recoveryAttentionTargets.filter(
        (target) => uploadAttentionTargetIdentity(target) !== suppressedAttentionIdentity,
      ),
    [recoveryAttentionTargets, suppressedAttentionIdentity],
  );
  const primaryTarget = useMemo(
    () => selectPrimaryRecoveryAttentionTarget(visibleRecoveryAttentionTargets, currentOtherUserId),
    [currentOtherUserId, visibleRecoveryAttentionTargets],
  );

  useEffect(() => {
    if (!hiddenAttentionTarget) return;
    const hiddenTargetStillExists = recoveryAttentionTargets.some(
      (target) => uploadAttentionTargetIdentity(target) === hiddenAttentionTarget.identity,
    );
    if (!hiddenTargetStillExists) setHiddenAttentionTarget(null);
  }, [hiddenAttentionTarget, recoveryAttentionTargets]);

  const visibleRecoveryAttentionCount = visibleRecoveryAttentionTargets.length;

  if (visibleRecoveryAttentionCount <= 0 || !primaryTarget) return null;

  const handlePress = () => {
    setHiddenAttentionTarget({
      identity: uploadAttentionTargetIdentity(primaryTarget),
      otherUserId: primaryTarget.otherUserId,
    });
    if (primaryTarget.otherUserId) {
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: primaryTarget.otherUserId,
          uploadAttention: primaryTarget.attentionId,
          uploadAttentionNonce: String(Date.now()),
        },
      });
      return;
    }
    router.push('/(tabs)/matches');
  };
  const attentionLabel = visibleRecoveryAttentionCount === 1
    ? primaryTarget.label
    : `${visibleRecoveryAttentionCount} uploads need attention`;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={attentionLabel}
      style={[
        uploadRecoveryStyles.banner,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={uploadRecoveryStyles.bannerText}>
        <Text style={[uploadRecoveryStyles.title, { color: theme.text }]}>
          {attentionLabel}
        </Text>
        <Text style={[uploadRecoveryStyles.subtitle, { color: theme.mutedForeground }]}>
          View the stuck upload in chat.
        </Text>
      </View>
      <Text style={[uploadRecoveryStyles.action, { color: theme.tint }]}>Review</Text>
    </Pressable>
  );
}

/** Emits the server-owned activity heartbeat every 5 minutes while foregrounded, skipped when on a break. */
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

/** Profile counter source-table changes → profile/live-count cache invalidation. */
function ProfileCountsRealtimeUpdater() {
  const { user } = useAuth();
  useProfileCountsRealtime(user?.id);
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

function SupabaseManagedAuthRefreshAppStateBridge() {
  const { loading, session, markSessionExpired } = useAuth();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const managedRefreshFailureCountRef = useRef(0);
  const managedRefreshInFlightRef = useRef(false);

  useEffect(() => {
    void supabase.auth.stopAutoRefresh();
  }, []);

  useEffect(() => {
    if (loading || !session?.refresh_token || typeof session.expires_at !== 'number') {
      managedRefreshFailureCountRef.current = 0;
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSession = session;
    const sessionUserId = session.user.id;
    managedRefreshFailureCountRef.current = 0;

    const clearRefreshTimer = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const isAppActive = () => appStateRef.current === 'active';

    const scheduleRetry = (reason: string, delayMs: number) => {
      clearRefreshTimer();
      if (cancelled || !isAppActive()) return;
      refreshTimer = setTimeout(() => {
        void attemptRefresh(`retry:${reason}`);
      }, delayMs);
    };

    const scheduleNext = (reason: string) => {
      clearRefreshTimer();
      if (
        cancelled ||
        !isAppActive() ||
        !activeSession.refresh_token ||
        typeof activeSession.expires_at !== 'number'
      ) return;
      const failureCount = managedRefreshFailureCountRef.current;
      const delayMs = failureCount > 0
        ? nextAuthRefreshDelayMs(failureCount)
        : Math.max(0, activeSession.expires_at * 1000 - Date.now() - AUTH_REFRESH_LEAD_MS);
      refreshTimer = setTimeout(() => {
        void attemptRefresh(`timer:${reason}`);
      }, delayMs);
    };

    async function recoverFromStaleRefreshRace(attemptedSession: NonNullable<typeof session>, reason: string) {
      for (const delayMs of AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS) {
        if (cancelled) return true;
        if (delayMs > 0) await sleep(delayMs);
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const latestSession = data.session;
        if (!isNewerAuthRefreshSession(latestSession, attemptedSession)) {
          continue;
        }

        activeSession = latestSession;
        primeCachedSession(latestSession);
        managedRefreshFailureCountRef.current = 0;
        rcBreadcrumb(RC_CATEGORY.authBoot, 'managed_refresh_stale_attempt_recovered', { reason });
        scheduleNext('stale_attempt_recovered');
        return true;
      }
      return false;
    }

    async function handleRefreshFailure(
      error: unknown,
      reason: string,
      attemptedSession: NonNullable<typeof session> = activeSession,
    ) {
      const kind = classifyAuthRefreshError(error);
      if (kind === 'invalid_session') {
        if (await recoverFromStaleRefreshRace(attemptedSession, reason)) {
          return;
        }
        rcBreadcrumb(RC_CATEGORY.authBoot, 'managed_refresh_invalid_session', {
          reason,
          error: authRefreshDebugInfo(error),
        });
        managedRefreshFailureCountRef.current = 0;
        invalidateCachedSession();
        await recoverNativeAuthSession('managed-refresh', error);
        markSessionExpired();
        return;
      }

      const failureCount = managedRefreshFailureCountRef.current + 1;
      managedRefreshFailureCountRef.current = failureCount;
      const delayMs = nextAuthRefreshDelayMs(failureCount);
      rcBreadcrumb(RC_CATEGORY.authBoot, 'managed_refresh_retry_scheduled', {
        reason,
        failure_count: failureCount,
        delay_ms: delayMs,
        error: authRefreshDebugInfo(error),
      });
      scheduleRetry(reason, delayMs);
    }

    async function attemptRefresh(reason: string) {
      if (cancelled) return;
      if (managedRefreshInFlightRef.current) {
        scheduleRetry(reason, 1_000);
        return;
      }
      if (!isAppActive()) return;
      if (!shouldRefreshSessionSoon(activeSession, Date.now()) && managedRefreshFailureCountRef.current === 0) {
        scheduleNext(reason);
        return;
      }

      const refreshSession = activeSession;
      managedRefreshInFlightRef.current = true;
      try {
        const refreshResponse = await requestManagedAuthRefresh({
          supabaseUrl: SUPABASE_URL,
          publishableKey: SUPABASE_PUBLISHABLE_KEY,
          refreshToken: refreshSession.refresh_token,
        });
        const nextSession = await applyManagedAuthRefreshSession(supabase.auth, refreshSession, refreshResponse, {
          shouldApply: () =>
            !cancelled &&
            activeSession.user.id === sessionUserId &&
            activeSession.refresh_token === refreshSession.refresh_token,
        });
        if (cancelled) return;
        if (!nextSession) return;
        if (nextSession.user.id !== sessionUserId) return;

        const recoveredAfterFailures = managedRefreshFailureCountRef.current;
        managedRefreshFailureCountRef.current = 0;
        activeSession = nextSession;
        primeCachedSession(nextSession);
        if (recoveredAfterFailures > 0) {
          rcBreadcrumb(RC_CATEGORY.authBoot, 'managed_refresh_succeeded', {
            reason,
            recovered_after_failures: recoveredAfterFailures,
          });
        }
        scheduleNext('success');
      } catch (error) {
        if (!cancelled) {
          await handleRefreshFailure(error, reason, refreshSession);
        }
      } finally {
        managedRefreshInFlightRef.current = false;
      }
    }

    const resumeRefresh = (reason: string) => {
      if (!isAppActive()) return;
      if (shouldRefreshSessionSoon(activeSession, Date.now()) || managedRefreshFailureCountRef.current > 0) {
        void attemptRefresh(reason);
        return;
      }
      scheduleNext(reason);
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState !== 'active') {
        clearRefreshTimer();
        return;
      }
      resumeRefresh('app_state_active');
    };

    handleAppStateChange(AppState.currentState);
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      cancelled = true;
      subscription.remove();
      clearRefreshTimer();
    };
  }, [loading, markSessionExpired, session]);

  return null;
}

function ReactQueryAppStateBridge() {
  useEffect(() => {
    const syncFocus = (nextState: AppStateStatus) => {
      focusManager.setFocused(nextState === 'active');
    };

    syncFocus(AppState.currentState);
    const subscription = AppState.addEventListener('change', syncFocus);

    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return null;
}

function NativeMediaSdkReconcileAppStateBridge() {
  const { session } = useAuth();
  const sessionUserId = session?.user?.id ?? null;
  const hasSession = Boolean(sessionUserId);

  useEffect(() => {
    if (!hasSession) return;
    const run = (reason: string) => {
      void Promise.all([
        import('@/lib/mediaSdk/nativeVideoUploads').then(({ reconcileNativeVideoMediaSdkQueue }) =>
          reconcileNativeVideoMediaSdkQueue(reason),
        ),
        import('@/lib/mediaSdk/nativeStorageUploads').then(({ reconcileNativeStorageMediaSdkQueue }) =>
          reconcileNativeStorageMediaSdkQueue(reason),
        ),
      ]).catch(() => undefined);
    };

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && shouldRunMediaSdkForegroundReconcile(`native:${sessionUserId ?? 'unknown'}`)) {
        run('app_state_active');
      }
    });

    return () => subscription.remove();
  }, [hasSession, sessionUserId]);

  return null;
}

function RealtimeLifecycleJanitor() {
  const pathname = usePathname();

  useEffect(() => {
    const timeout = setTimeout(() => {
      pruneDuplicateRealtimeChannels(supabase, `route:${pathname}`);
    }, 0);
    return () => clearTimeout(timeout);
  }, [pathname]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        pruneDuplicateRealtimeChannels(supabase, `app_state:${nextState}`);
      }
    });
    return () => subscription.remove();
  }, []);

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
  'profile-preview',
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
  const { session, loading, authRedirectReason, entryState, entryStateLoading } = useAuth();
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
    if (authRedirectReason === 'session_expired') {
      return (
        <Redirect
          href={{
            pathname: '/(auth)/sign-in',
            params: { authError: 'Your session expired. Sign in again to continue.' },
          }}
        />
      );
    }
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
  const theme = Colors[colorScheme];
  useCurrentRouteTracker();
  const [, setCdnHostInitTick] = useState(0);
  const [referralSyncTick, setReferralSyncTick] = useState(0);
  const [analyticsConsentGranted, setAnalyticsConsentGranted] = useState(false);

  useEffect(() => {
    initRevenueCat();
    connectivityService.init();
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    // Keep analytics wrappers safe and quiet when PostHog is disabled.
    if (!POSTHOG_ENABLED || !analyticsConsentGranted) {
      setPostHogClient(null);
    }
  }, [analyticsConsentGranted]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeNativeAnalyticsConsent((state) => {
      setAnalyticsConsentGranted(state === 'granted');
    });
    void hydrateRuntimeAnalyticsConsent().then((state) => {
      if (!cancelled) setAnalyticsConsentGranted(state === 'granted');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
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

  const navigationTheme = useMemo(
    () => ({
      ...DarkTheme,
      dark: true,
      colors: {
        ...DarkTheme.colors,
        primary: theme.tint,
        background: theme.background,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        notification: theme.accent,
      },
    }),
    [theme],
  );

  const stack = (
    <ThemeProvider value={navigationTheme}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="entry-recovery" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[eventId]/lobby" options={{ headerShown: false, title: 'Event Lobby' }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false, title: 'Chat', gestureEnabled: false }} />
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
    <>
      <StatusBar style="light" backgroundColor={theme.background} />
      <QueryClientProvider client={queryClient}>
        <ReactQueryAppStateBridge />
        <AuthProvider>
          <EntitlementsProvider>
          <SessionHydrationProvider>
          <MatchCallProvider>
            <ChatOutboxProvider>
            <SupabaseManagedAuthRefreshAppStateBridge />
            <NativeMediaSdkReconcileAppStateBridge />
            <RealtimeLifecycleJanitor />
            <AuthRedirectHandler onReferralCaptured={() => setReferralSyncTick((t) => t + 1)} />
            <ReferralAttributionSync syncTick={referralSyncTick} />
            <PushRegistration />
            <NotificationRouteTracker />
            <NativeSessionRouteHydration />
            <NotificationDeepLinkHandler />
            <NotificationPauseForeground />
            <DeactivatedAccountReactivationPrompt />
            <ActivityHeartbeat />
            <RevenueCatUserSync />
            <BadgeCountUpdater />
            <EventsRealtimeUpdater />
            <ProfileCountsRealtimeUpdater />
            <ChatOutboxRunner />
            <PostDateOutboxRunner />
            <View style={{ flex: 1, backgroundColor: theme.background }}>
              <View style={{ flex: 1, backgroundColor: theme.background }}>
                {POSTHOG_ENABLED && analyticsConsentGranted ? (
                  <PostHogProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
                    <PostHogScreenTracker />
                    {gatedStack}
                  </PostHogProvider>
                ) : (
                  gatedStack
                )}
              </View>
              <OfflineBanner />
              <NativeUploadRecoveryGlobalBanner theme={theme} />
            </View>
            </ChatOutboxProvider>
          </MatchCallProvider>
          </SessionHydrationProvider>
          </EntitlementsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </>
  );

  return navContent;
}

const uploadRecoveryStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 52,
    zIndex: 40,
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  action: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default Sentry.wrap(RootLayout);
