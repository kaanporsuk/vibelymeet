import * as Sentry from "@sentry/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AlertTriangle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineBanner } from "@/components/connectivity/OfflineBanner";
import { useEffect } from "react";
import posthog from 'posthog-js';
import Index from "./pages/Index";
import Onboarding from "./pages/onboarding";
import Auth from "./pages/Auth";
import EntryRecovery from "./pages/EntryRecovery";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import EventDetails from "./pages/EventDetails";
import EventLobby from "./pages/EventLobby";
import Matches from "./pages/Matches";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import ProfilePreview from "./pages/ProfilePreview";
import Settings from "./pages/Settings";
import VideoDate from "./pages/VideoDate";
import ReadyRedirect from "./pages/ReadyRedirect";
import AdminCreateEvent from "./pages/AdminCreateEvent";
import VibeStudio from "./pages/VibeStudio";
import Schedule from "./pages/Schedule";
import HowItWorks from "./pages/HowItWorks";
import UserProfile from "./pages/UserProfile";
import ResetPassword from "./pages/ResetPassword";
import InviteRedirect from "./pages/InviteRedirect";
import EventShortRedirect from "./pages/EventShortRedirect";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import TermsOfService from "./pages/legal/TermsOfService";
import DeleteAccountWeb from "./pages/legal/DeleteAccountWeb";
import CommunityGuidelines from "./pages/legal/CommunityGuidelines";
import Premium from "./pages/Premium";
import SubscriptionSuccess from "./pages/SubscriptionSuccess";
import SubscriptionCancel from "./pages/SubscriptionCancel";
import EventPaymentSuccess from "./pages/EventPaymentSuccess";
import Credits from "./pages/Credits";
import CreditsSuccess from "./pages/CreditsSuccess";
import Referrals from "./pages/Referrals";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import { NotificationProvider } from "./contexts/NotificationContext";
import { SessionHydrationProvider } from "./contexts/SessionHydrationContext";
import { SessionRouteHydration } from "./components/session/SessionRouteHydration";
import { AuthProvider } from "@/contexts/AuthContext";
import NotificationContainer from "./components/notifications/NotificationContainer";
import { NotificationManager } from "./components/notifications/NotificationManager";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PushPermissionPrompt } from "./components/PushPermissionPrompt";
import { WebPasswordRecoveryHandler } from "./components/WebPasswordRecoveryHandler";
import { useActivityHeartbeat } from "./hooks/useActivityHeartbeat";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { WebOnBreakBanner } from "@/components/layout/WebOnBreakBanner";
import { WebPendingDeletionBanner } from "@/components/layout/WebPendingDeletionBanner";
import { MatchCallProvider } from "@/hooks/useMatchCall";
import { WebChatOutboxProvider, WebChatOutboxRunner } from "@/contexts/WebChatOutboxContext";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";

const PostHogPageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    posthog.capture('$pageview', {
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

// queryClient is imported from @/lib/queryClient (singleton used by controller)

const SentryFallback = ({ resetError }: { resetError: () => void }) => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
    <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
      <AlertTriangle className="w-8 h-8 text-destructive" />
    </div>
    <h1 className="text-2xl font-display font-bold text-foreground mb-2">Something went wrong</h1>
    <p className="text-muted-foreground mb-6 max-w-sm">
      We've been notified and are looking into it. Try refreshing the page.
    </p>
    <div className="flex gap-3">
      <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      <Button variant="outline" onClick={resetError}>Try Again</Button>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <WebChatOutboxProvider>
      <SessionHydrationProvider>
      <NotificationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner position="top-center" theme="dark" richColors />
          <OfflineBanner />
          <Sentry.ErrorBoundary
            fallback={({ resetError }) => <SentryFallback resetError={resetError} />}
            onError={(error) => {
              console.error("Caught by Sentry ErrorBoundary:", error);
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
                },
              });
            }}
          >
            <BrowserRouter>
              <MatchCallProvider>
                <WebChatOutboxRunner />
                <WebPasswordRecoveryHandler />
                <PostHogPageTracker />
                <SessionRouteHydration />
                <WebOnBreakBanner />
                <WebPendingDeletionBanner />
                <AppContent />
                <NotificationContainer />
                <NotificationManager />
                <PushPermissionPrompt />
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
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
                  <Route path="/credits" element={<ProtectedRoute><Credits /></ProtectedRoute>} />
                  <Route path="/credits/success" element={<ProtectedRoute><CreditsSuccess /></ProtectedRoute>} />
                  <Route path="/user/:userId" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
                  {/* Admin Routes */}
                  <Route path="/kaan" element={<AdminLogin />} />
                  <Route path="/kaan/dashboard" element={<ProtectedRoute requireAdmin requireOnboarding={false}><AdminDashboard /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </MatchCallProvider>
            </BrowserRouter>
          </Sentry.ErrorBoundary>
        </TooltipProvider>
      </NotificationProvider>
      </SessionHydrationProvider>
      </WebChatOutboxProvider>
    </AuthProvider>
    <SpeedInsights />
    <Analytics />
  </QueryClientProvider>
);

export default App;
