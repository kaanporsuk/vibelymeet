import * as Sentry from "@sentry/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineBanner } from "@/components/connectivity/OfflineBanner";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { NotificationProvider } from "./contexts/NotificationContext";
import { SessionHydrationProvider } from "./contexts/SessionHydrationContext";
import { EntitlementsProvider } from "./contexts/EntitlementsContext";
import { SessionRouteHydration } from "./components/session/SessionRouteHydration";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import NotificationContainer from "./components/notifications/NotificationContainer";
import { NotificationManager } from "./components/notifications/NotificationManager";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { WebAuthReturnHandler } from "./components/WebAuthReturnHandler";
import { WebPasswordRecoveryHandler } from "./components/WebPasswordRecoveryHandler";
import { useActivityHeartbeat } from "./hooks/useActivityHeartbeat";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { WebOnBreakBanner } from "@/components/layout/WebOnBreakBanner";
import { WebPendingDeletionBanner } from "@/components/layout/WebPendingDeletionBanner";
import { useWebChatOutbox, WebChatOutboxProvider, WebChatOutboxRunner } from "@/contexts/WebChatOutboxContext";
import { WebPostDateOutboxRunner } from "@/lib/postDateOutbox/WebPostDateOutboxRunner";
import { supabase } from "@/integrations/supabase/client";
import {
  hasStaleBundleReloadAlreadyAttempted,
  instrumentSupabaseRealtimeDiagnostics,
  isLikelyStaleBundleError,
  pruneDuplicateRealtimeChannels,
  recoverFromStaleBundleError,
  recordBrowserError,
  recordBrowserEvent,
} from "@/lib/browserDiagnostics";
import { initAnalytics, disableAnalytics, trackEvent } from "@/lib/analytics";
import { lazyWithPreload } from "@/lib/lazyWithPreload";
import { preloadRouteOnIdle, routeLoaders } from "@/lib/routePreload";
import { isSpeedInsightsDateRouteSuppressed } from "@/lib/runtimeFlags";
import {
  readAnalyticsConsent,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
  type AnalyticsConsentState,
} from "@/lib/consent";
import {
  fetchMyProfile,
  fetchProfileLiveCounts,
  MY_PROFILE_STALE_TIME_MS,
  PROFILE_LIVE_COUNTS_STALE_TIME_MS,
  myProfileQueryKey,
  profileLiveCountsQueryKey,
} from "@/services/profileService";
import {
  selectPrimaryRecoveryAttentionTarget,
  type UploadAttentionTarget,
  uploadAttentionTargetIdentity,
} from "../shared/chat/uploadAttentionTargets";

const Index = lazyWithPreload(routeLoaders.index);
const Auth = lazyWithPreload(routeLoaders.auth);
const AuthChallenge = lazyWithPreload(routeLoaders.authChallenge);
const EntryRecovery = lazyWithPreload(routeLoaders.entryRecovery);
const InviteRedirect = lazyWithPreload(routeLoaders.inviteRedirect);
const EventShortRedirect = lazyWithPreload(routeLoaders.eventShortRedirect);
const ResetPassword = lazyWithPreload(routeLoaders.resetPassword);
const Onboarding = lazyWithPreload(routeLoaders.onboarding);
const Dashboard = lazyWithPreload(routeLoaders.dashboard);
const Events = lazyWithPreload(routeLoaders.events);
const EventDetails = lazyWithPreload(routeLoaders.eventDetails);
const EventLobby = lazyWithPreload(routeLoaders.eventLobby);
const Matches = lazyWithPreload(routeLoaders.matches);
const Chat = lazyWithPreload(routeLoaders.chat);
const Profile = lazyWithPreload(routeLoaders.profile);
const ProfilePreview = lazyWithPreload(routeLoaders.profilePreview);
const Settings = lazyWithPreload(routeLoaders.settings);
const Referrals = lazyWithPreload(routeLoaders.referrals);
const VideoDate = lazyWithPreload(routeLoaders.videoDate);
const ReadyRedirect = lazyWithPreload(routeLoaders.readyRedirect);
const AdminCreateEvent = lazyWithPreload(routeLoaders.adminCreateEvent);
const AdminDashboard = lazyWithPreload(routeLoaders.adminDashboard);
const VibeStudio = lazyWithPreload(routeLoaders.vibeStudio);
const Schedule = lazyWithPreload(routeLoaders.schedule);
const HowItWorks = lazyWithPreload(routeLoaders.howItWorks);
const PrivacyPolicy = lazyWithPreload(routeLoaders.privacy);
const TermsOfService = lazyWithPreload(routeLoaders.terms);
const DeleteAccountWeb = lazyWithPreload(routeLoaders.deleteAccount);
const CommunityGuidelines = lazyWithPreload(routeLoaders.communityGuidelines);
const Premium = lazyWithPreload(routeLoaders.premium);
const SubscriptionSuccess = lazyWithPreload(routeLoaders.subscriptionSuccess);
const SubscriptionCancel = lazyWithPreload(routeLoaders.subscriptionCancel);
const EventPaymentSuccess = lazyWithPreload(routeLoaders.eventPaymentSuccess);
const Credits = lazyWithPreload(routeLoaders.credits);
const CreditsSuccess = lazyWithPreload(routeLoaders.creditsSuccess);
const UserProfile = lazyWithPreload(routeLoaders.userProfile);
const AdminLogin = lazyWithPreload(routeLoaders.adminLogin);
const NotFound = lazyWithPreload(routeLoaders.notFound);

instrumentSupabaseRealtimeDiagnostics(supabase);
const PushPermissionPrompt = lazy(() =>
  import("./components/PushPermissionPrompt").then((mod) => ({ default: mod.PushPermissionPrompt }))
);
const VercelAnalyticsBundle = lazy(() =>
  Promise.all([
    import("@vercel/speed-insights/react"),
    import("@vercel/analytics/react"),
  ]).then(([speedInsights, analytics]) => ({
    default: function VercelAnalyticsBundleInner() {
      const SpeedInsights = speedInsights.SpeedInsights;
      const Analytics = analytics.Analytics;
      const suppressDateRouteSpeedInsights = isSpeedInsightsDateRouteSuppressed();
      return (
        <>
          <SpeedInsights
            beforeSend={(event) => {
              if (!suppressDateRouteSpeedInsights) return event;
              try {
                const pathname = new URL(event.url, window.location.origin).pathname;
                if (/^\/date\/[^/]+\/?$/.test(pathname)) return null;
              } catch {
                return event;
              }
              return event;
            }}
          />
          <Analytics />
        </>
      );
    },
  }))
);

const PostHogPageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    recordBrowserEvent("browser.route_view", {
      route: location.pathname,
      current_url: window.location.href,
    });
    trackEvent('$pageview', {
      $current_url: window.location.href,
    });
  }, [location.pathname]);

  return null;
};

const AppContent = () => {
  useActivityHeartbeat();
  useAppBootstrap();
  return null;
};

const WebProfileWarmup = () => {
  const { session, isAuthenticated, isLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (isLoading || !isAuthenticated || !userId) return;

    const warmProfileCache = () => {
      void queryClient.prefetchQuery({
        queryKey: myProfileQueryKey(userId),
        queryFn: async () => {
          const profile = await fetchMyProfile(userId);
          if (!profile) throw new Error("Profile not ready");
          return profile;
        },
        staleTime: MY_PROFILE_STALE_TIME_MS,
      });
      void queryClient.prefetchQuery({
        queryKey: profileLiveCountsQueryKey(userId),
        queryFn: () => fetchProfileLiveCounts(userId),
        staleTime: PROFILE_LIVE_COUNTS_STALE_TIME_MS,
      });
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(warmProfileCache, { timeout: 1500 });
    } else {
      timeoutHandle = window.setTimeout(warmProfileCache, 250);
    }

    return () => {
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [isAuthenticated, isLoading, userId]);

  return null;
};

const WebProfileCountsInvalidator = () => {
  const { session, isAuthenticated, isLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (isLoading || !isAuthenticated || !userId) return;

    const invalidateProfileCounts = () => {
      void queryClient.invalidateQueries({ queryKey: profileLiveCountsQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: myProfileQueryKey(userId) });
    };

    const channel = supabase
      .channel(`web-profile-counts-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_registrations", filter: `profile_id=eq.${userId}` },
        invalidateProfileCounts,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        invalidateProfileCounts,
      );

    for (const filter of [`profile_id_1=eq.${userId}`, `profile_id_2=eq.${userId}`]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter },
        invalidateProfileCounts,
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAuthenticated, isLoading, userId]);

  return null;
};

function currentChatOtherUserId(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function uploadAttentionTargetValidationKey(target: UploadAttentionTarget): string {
  return [
    uploadAttentionTargetIdentity(target),
    target.status,
    String(target.updatedAtMs),
  ].join(":");
}

const WebUploadRecoveryNotifier = () => {
  const {
    items,
    recoveryAttentionTargets,
    validateRecoveryAttentionTarget,
    skipRecoveryAttentionTarget,
  } = useWebChatOutbox();
  const navigate = useNavigate();
  const location = useLocation();
  const hiddenWithActiveUploadRef = useRef(false);
  const validationRunRef = useRef(0);
  const candidateRecoveryAttentionTargetsRef = useRef<UploadAttentionTarget[]>([]);
  const attentionActionRef = useRef<"review" | "skip" | null>(null);
  const [hiddenAttentionTarget, setHiddenAttentionTarget] = useState<{
    identity: string;
    otherUserId: string | null;
  } | null>(null);
  const [validatedRecoveryAttentionTargets, setValidatedRecoveryAttentionTargets] = useState<UploadAttentionTarget[]>([]);
  const [attentionAction, setAttentionAction] = useState<"review" | "skip" | null>(null);
  const currentOtherUserId = useMemo(
    () => currentChatOtherUserId(location.pathname),
    [location.pathname],
  );
  const shouldSuppressHiddenTarget = Boolean(
    hiddenAttentionTarget &&
      (hiddenAttentionTarget.otherUserId
        ? hiddenAttentionTarget.otherUserId === currentOtherUserId
        : currentOtherUserId === null),
  );
  const suppressedAttentionIdentity = shouldSuppressHiddenTarget
    ? hiddenAttentionTarget?.identity ?? ""
    : "";
  const candidateRecoveryAttentionTargets = useMemo(
    () =>
      recoveryAttentionTargets.filter(
        (target) => uploadAttentionTargetIdentity(target) !== suppressedAttentionIdentity,
      ),
    [recoveryAttentionTargets, suppressedAttentionIdentity],
  );
  const candidateRecoveryAttentionKey = useMemo(
    () => candidateRecoveryAttentionTargets.map(uploadAttentionTargetValidationKey).join("|"),
    [candidateRecoveryAttentionTargets],
  );

  useEffect(() => {
    candidateRecoveryAttentionTargetsRef.current = candidateRecoveryAttentionTargets;
  }, [candidateRecoveryAttentionTargets]);

  useEffect(() => {
    const runId = validationRunRef.current + 1;
    validationRunRef.current = runId;
    const targets = candidateRecoveryAttentionTargetsRef.current;
    if (targets.length === 0) {
      setValidatedRecoveryAttentionTargets([]);
      return;
    }

    setValidatedRecoveryAttentionTargets([]);
    let cancelled = false;
    void (async () => {
      const validTargets: UploadAttentionTarget[] = [];
      for (const target of targets) {
        let result: Awaited<ReturnType<typeof validateRecoveryAttentionTarget>> | null = null;
        try {
          result = await validateRecoveryAttentionTarget(target);
        } catch {
          result = null;
        }
        if (cancelled || validationRunRef.current !== runId) return;
        if (result?.status === "valid") validTargets.push(result.target);
      }
      if (!cancelled && validationRunRef.current === runId) {
        setValidatedRecoveryAttentionTargets(validTargets);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [candidateRecoveryAttentionKey, validateRecoveryAttentionTarget]);

  const visibleRecoveryAttentionTargets = validatedRecoveryAttentionTargets;
  const primaryTarget = useMemo(
    () => selectPrimaryRecoveryAttentionTarget(visibleRecoveryAttentionTargets, currentOtherUserId),
    [currentOtherUserId, visibleRecoveryAttentionTargets],
  );
  const beginAttentionAction = useCallback((action: "review" | "skip") => {
    if (attentionActionRef.current) return false;
    attentionActionRef.current = action;
    setAttentionAction(action);
    return true;
  }, []);
  const endAttentionAction = useCallback(() => {
    attentionActionRef.current = null;
    setAttentionAction(null);
  }, []);
  const handleReview = useCallback(async () => {
    if (!primaryTarget) return;
    if (!beginAttentionAction("review")) return;
    try {
      const validation = await validateRecoveryAttentionTarget(primaryTarget);
      if (validation.status !== "valid") {
        if (validation.status === "unknown") {
          toast.error("Could not verify that upload yet. Try again in a moment.");
        } else {
          toast.info("That upload was already cleared or sent.");
        }
        return;
      }
      const target = validation.target;
      setHiddenAttentionTarget({
        identity: uploadAttentionTargetIdentity(target),
        otherUserId: target.otherUserId,
      });
      if (!target.otherUserId) {
        navigate("/matches");
        return;
      }
      const params = new URLSearchParams({
        uploadAttention: target.attentionId,
        uploadAttentionClientRequestId: target.clientRequestId,
        uploadAttentionNonce: String(Date.now()),
      });
      navigate(`/chat/${encodeURIComponent(target.otherUserId)}?${params.toString()}`);
    } catch {
      toast.error("Could not verify that upload yet. Try again in a moment.");
    } finally {
      endAttentionAction();
    }
  }, [beginAttentionAction, endAttentionAction, navigate, primaryTarget, validateRecoveryAttentionTarget]);

  const handleSkip = useCallback(async () => {
    if (!primaryTarget) return;
    if (!beginAttentionAction("skip")) return;
    try {
      const result = await skipRecoveryAttentionTarget(primaryTarget);
      if (result.status === "failed") {
        toast.error("Could not clear that upload yet. Try again in a moment.");
        return;
      }
      if (result.status === "removed") {
        toast.info("Upload cleared.");
        return;
      }
      toast.info("That upload was already cleared or sent.");
    } catch {
      toast.error("Could not clear that upload yet. Try again in a moment.");
    } finally {
      endAttentionAction();
    }
  }, [beginAttentionAction, endAttentionAction, primaryTarget, skipRecoveryAttentionTarget]);
  const activeUploadCount = items.filter(
    (item) =>
      item.payload.kind !== "text" &&
      (item.state === "queued" ||
        item.state === "sending" ||
        item.state === "waiting_for_network" ||
        item.state === "awaiting_hydration"),
  ).length;

  useEffect(() => {
    if (!hiddenAttentionTarget) return;
    const hiddenTargetStillExists = recoveryAttentionTargets.some(
      (target) => uploadAttentionTargetIdentity(target) === hiddenAttentionTarget.identity,
    );
    if (!hiddenTargetStillExists) setHiddenAttentionTarget(null);
  }, [hiddenAttentionTarget, recoveryAttentionTargets]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenWithActiveUploadRef.current = activeUploadCount > 0;
        return;
      }
      if (!hiddenWithActiveUploadRef.current) return;
      hiddenWithActiveUploadRef.current = false;
      toast.info("Uploads resume when you return. We'll continue from saved progress.", {
        id: "media-upload-foreground-resume",
        duration: 5000,
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeUploadCount]);

  const visibleRecoveryAttentionCount = visibleRecoveryAttentionTargets.length;

  if (visibleRecoveryAttentionCount <= 0 || !primaryTarget) return null;

  const attentionLabel = visibleRecoveryAttentionCount === 1
    ? primaryTarget.label
    : `${visibleRecoveryAttentionCount} uploads need attention`;

  return (
    <div
      role="region"
      aria-label={attentionLabel}
      aria-live="polite"
      className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-cyan-400/30 bg-background/95 px-3 py-2 text-foreground shadow-xl shadow-black/30 backdrop-blur-md"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {attentionLabel}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          Review recovery options in chat.
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2"
        aria-label="Skip upload attention"
        disabled={attentionAction !== null}
        onClick={handleSkip}
      >
        Skip
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="h-8 px-3"
        aria-label="Review upload needing attention"
        disabled={attentionAction !== null}
        onClick={handleReview}
      >
        Review
      </Button>
    </div>
  );
};

const RoutePrefetcher = () => {
  const location = useLocation();
  const { isAuthenticated, entryState, entryStateLoading } = useAuth();

  useEffect(() => {
    if (!isAuthenticated && location.pathname === "/") {
      preloadRouteOnIdle("auth");
      return;
    }

    if (isAuthenticated && !entryStateLoading && entryState) {
      if (entryState.route_hint === "app") {
        preloadRouteOnIdle("dashboard");
        preloadRouteOnIdle("events");
        preloadRouteOnIdle("matches");
        preloadRouteOnIdle("eventLobby");
        return;
      }
      if (entryState.route_hint === "onboarding") {
        preloadRouteOnIdle("onboarding");
        return;
      }
      preloadRouteOnIdle("entryRecovery");
    }
  }, [entryState, entryStateLoading, isAuthenticated, location.pathname]);

  return null;
};

const AuthenticatedPushPermissionPrompt = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) return null;

  return (
    <Suspense fallback={null}>
      <PushPermissionPrompt />
    </Suspense>
  );
};

const WebHomeUnreadInvalidator = () => {
  const { session, isAuthenticated, isLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (isLoading || !isAuthenticated || !userId) return;
    const invalidateHomeUnread = () => {
      void queryClient.invalidateQueries({ queryKey: ["unread-home"] });
      void queryClient.invalidateQueries({ queryKey: ["unread-home-info-bar"] });
      void queryClient.invalidateQueries({ queryKey: ["matches"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
    };
    const channel = supabase
      .channel(`web-home-unread-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_archives", filter: `user_id=eq.${userId}` },
        invalidateHomeUnread,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAuthenticated, isLoading, userId]);

  return null;
};

const RealtimeLifecycleJanitor = () => {
  const location = useLocation();

  useEffect(() => {
    window.setTimeout(() => {
      pruneDuplicateRealtimeChannels(supabase, `route:${location.pathname}`);
    }, 0);
  }, [location.pathname]);

  useEffect(() => {
    const prune = (reason: string) => {
      pruneDuplicateRealtimeChannels(supabase, reason);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") prune("tab_hidden");
    };
    const onPageHide = () => prune("pagehide");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
};

const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
);

// queryClient is imported from @/lib/queryClient (singleton used by controller)

const SentryFallback = ({ error, resetError }: { error: unknown; resetError: () => void }) => {
  const staleBundleAfterReload =
    isLikelyStaleBundleError(error) && hasStaleBundleReloadAlreadyAttempted();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-2">
        {staleBundleAfterReload ? "New Version Available" : "Something went wrong"}
      </h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        {staleBundleAfterReload
          ? "Reload this tab to pick up the latest Vibely code, then enter the lobby again."
          : "We've been notified and are looking into it. Try refreshing the page."}
      </p>
      <div className="flex gap-3">
        <Button onClick={() => window.location.reload()}>
          {staleBundleAfterReload ? "Reload App" : "Refresh Page"}
        </Button>
        <Button variant="outline" onClick={resetError}>Try Again</Button>
      </div>
    </div>
  );
};

function AnalyticsConsentBanner({ consent }: { consent: AnalyticsConsentState }) {
  if (consent !== "unset") return null;

  const allow = () => {
    setAnalyticsConsent(true);
    initAnalytics();
  };

  const deny = () => {
    setAnalyticsConsent(false);
    disableAnalytics();
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-50 mx-auto max-w-3xl rounded-md border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Allow privacy-conscious analytics so we can improve reliability and product quality.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={deny}>Not now</Button>
          <Button size="sm" onClick={allow}>Allow</Button>
        </div>
      </div>
    </div>
  );
}

const App = () => {
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsentState>(() => readAnalyticsConsent());
  const analyticsAllowed = analyticsConsent === "granted";

  useEffect(() => subscribeAnalyticsConsent(setAnalyticsConsentState), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <EntitlementsProvider>
        <WebChatOutboxProvider>
        <SessionHydrationProvider>
        <NotificationProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner position="top-center" theme="dark" richColors />
            <OfflineBanner />
            <Sentry.ErrorBoundary
              fallback={({ error, resetError }) => <SentryFallback error={error} resetError={resetError} />}
              onError={(error) => {
                console.error("Caught by Sentry ErrorBoundary:", error);
                const staleBundleRecovery = recoverFromStaleBundleError(error, "react_error_boundary", {
                  route: typeof window !== "undefined" ? window.location.pathname : null,
                });
                recordBrowserError("browser.react_error_boundary", error, {
                  route: typeof window !== "undefined" ? window.location.pathname : null,
                  stale_bundle_recovery_action: staleBundleRecovery.isStaleBundleError
                    ? staleBundleRecovery.reloadScheduled
                      ? "reload"
                      : "show_error"
                    : "none",
                });
                const msg = error instanceof Error ? error.message : String(error);
                Sentry.addBreadcrumb({
                  category: "react.error_boundary",
                  level: "fatal",
                  message: msg.slice(0, 240),
                  data: {
                    pathname: typeof window !== "undefined" ? window.location.pathname : null,
                    search: typeof window !== "undefined" ? window.location.search : null,
                    is_date_route:
                      typeof window !== "undefined" &&
                      /^\/date\/[^/]+\/?$/.test(window.location.pathname),
                    stale_bundle_error: staleBundleRecovery.isStaleBundleError,
                    stale_bundle_reload_scheduled: staleBundleRecovery.reloadScheduled,
                  },
                });
              }}
            >
              <BrowserRouter>
                  <WebChatOutboxRunner />
                  <WebUploadRecoveryNotifier />
                  <WebPostDateOutboxRunner />
                  <WebAuthReturnHandler />
                  <WebPasswordRecoveryHandler />
                  <PostHogPageTracker />
                  <RealtimeLifecycleJanitor />
                  <RoutePrefetcher />
                  <WebProfileWarmup />
                  <WebProfileCountsInvalidator />
                  <WebHomeUnreadInvalidator />
                  <SessionRouteHydration />
                  <WebOnBreakBanner />
                  <WebPendingDeletionBanner />
                  <AppContent />
                  <NotificationContainer />
                  <NotificationManager />
                  <AuthenticatedPushPermissionPrompt />
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/auth/challenge" element={<AuthChallenge />} />
                      <Route path="/entry-recovery" element={<ProtectedRoute><EntryRecovery /></ProtectedRoute>} />
                      <Route path="/invite" element={<InviteRedirect />} />
                      <Route path="/event/:eventId" element={<EventShortRedirect />} />
                      <Route path="/reset-password" element={<ResetPassword />} />
                      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
                      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/home" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
                      <Route path="/events/:id" element={<ProtectedRoute><EventDetails /></ProtectedRoute>} />
                      <Route path="/event/:eventId/lobby" element={<ProtectedRoute><EventLobby /></ProtectedRoute>} />
                      <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
                      <Route path="/chat/:id" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
                      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                      <Route path="/profile/preview" element={<ProtectedRoute><ProfilePreview /></ProtectedRoute>} />
                      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                      <Route path="/settings/referrals" element={<ProtectedRoute><Referrals /></ProtectedRoute>} />
                      <Route path="/settings/ticket/:id" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                      <Route path="/date/:id" element={<ProtectedRoute><VideoDate /></ProtectedRoute>} />
                      <Route path="/ready/:readyId" element={<ProtectedRoute><ReadyRedirect /></ProtectedRoute>} />
                      <Route path="/admin/create-event" element={<ProtectedRoute requireAdmin><AdminCreateEvent /></ProtectedRoute>} />
                      <Route path="/admin/feature-flags" element={<ProtectedRoute requireAdmin requireOnboarding={false}><Navigate to="/kaan/dashboard?panel=feature-flags" replace /></ProtectedRoute>} />
                      <Route path="/vibe-studio" element={<ProtectedRoute><VibeStudio /></ProtectedRoute>} />
                      <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
                      <Route path="/how-it-works" element={<HowItWorks />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />
                      <Route path="/terms" element={<TermsOfService />} />
                      <Route path="/delete-account" element={<DeleteAccountWeb />} />
                      <Route path="/community-guidelines" element={<CommunityGuidelines />} />
                      <Route path="/premium" element={<Premium />} />
                      <Route path="/subscription/success" element={<SubscriptionSuccess />} />
                      <Route path="/subscription/cancel" element={<SubscriptionCancel />} />
                      <Route path="/event-payment/success" element={<ProtectedRoute><EventPaymentSuccess /></ProtectedRoute>} />
                      <Route path="/event-payment-success" element={<ProtectedRoute><EventPaymentSuccess /></ProtectedRoute>} />
                      <Route path="/credits" element={<ProtectedRoute><Credits /></ProtectedRoute>} />
                      <Route path="/credits/success" element={<ProtectedRoute><CreditsSuccess /></ProtectedRoute>} />
                      <Route path="/user/:userId" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
                      {/* Admin Routes */}
                      <Route path="/kaan" element={<AdminLogin />} />
                      <Route path="/kaan/dashboard" element={<ProtectedRoute requireAdmin requireOnboarding={false}><AdminDashboard /></ProtectedRoute>} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
              </BrowserRouter>
            </Sentry.ErrorBoundary>
            <AnalyticsConsentBanner consent={analyticsConsent} />
          </TooltipProvider>
        </NotificationProvider>
        </SessionHydrationProvider>
        </WebChatOutboxProvider>
        </EntitlementsProvider>
      </AuthProvider>
      {analyticsAllowed ? (
        <Suspense fallback={null}>
          <VercelAnalyticsBundle />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
};

export default App;
