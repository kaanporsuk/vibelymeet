import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, WifiOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireOnboarding = true
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, session, isOfflineAtBoot, entryState, entryStateLoading, isProfileLoading } = useAuth();
  const location = useLocation();

  // Server-side admin role verification via edge function - cannot be bypassed
  const { data: isServerVerifiedAdmin, isLoading: isAdminCheckLoading } = useQuery({
    queryKey: ['verify-admin-role', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return false;

      try {
        const { data, error } = await supabase.functions.invoke('verify-admin', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (error) {
          console.error('Admin verification error');
          return false;
        }

        return data?.isAdmin === true;
      } catch (err) {
        console.error('Admin verification failed');
        return false;
      }
    },
    enabled: !!session?.user?.id && requireAdmin,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const isCheckingAdmin = requireAdmin && isAdminCheckLoading;

  // Show loading while: initial auth check, profile loading, or admin check
  if (isLoading || (requireOnboarding && isAuthenticated && (isProfileLoading || entryStateLoading)) || isCheckingAdmin) {
    if (isOfflineAtBoot) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
            <WifiOff className="w-8 h-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-2">No Internet Connection</h1>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Vibely needs an internet connection to work. Please check your Wi-Fi or mobile data and try again.
          </p>
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const search = location.search;
    return <Navigate to={search ? `/auth${search}` : "/auth"} replace />;
  }

  // Server-side verified admin check - cannot be bypassed via client-side manipulation
  if (requireAdmin && !isServerVerifiedAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireOnboarding) {
    const state = entryState?.state ?? 'hard_error';
    const isOnboardingRoute = location.pathname === '/onboarding';
    const isRecoveryRoute = location.pathname === '/entry-recovery';

    if (state === 'complete') {
      if (isOnboardingRoute || isRecoveryRoute) {
        return <Navigate to="/home" replace />;
      }
    }

    if (state === 'incomplete') {
      if (!isOnboardingRoute) {
        return <Navigate to="/onboarding" replace />;
      }
    }

    if (
      state === 'missing_profile'
      || state === 'suspected_fragmented_identity'
      || state === 'account_suspended'
      || state === 'hard_error'
    ) {
      if (!isRecoveryRoute) {
        return <Navigate to="/entry-recovery" replace />;
      }
    }
  }

  return <>{children}</>;
}
