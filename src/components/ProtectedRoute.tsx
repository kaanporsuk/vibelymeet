import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Loader2, RefreshCw, ShieldOff, WifiOff } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireOnboarding?: boolean;
}

type AdminVerificationStatus = "admin" | "not_admin" | "unauthenticated";

type AdminVerificationResult = {
  isAdmin: boolean;
  status: AdminVerificationStatus;
  message?: string;
};

function functionErrorStatus(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof context === "object") {
    const status = (context as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

function adminVerificationMessage(error: unknown) {
  const status = functionErrorStatus(error);
  if (status) return `Admin verification failed (HTTP ${status}).`;
  return "Admin verification failed. Please retry before continuing.";
}

function AdminAccessProblem({
  kind,
  message,
  isRetrying,
  onRetry,
  onSignOut,
}: {
  kind: "denied" | "error";
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const Icon = kind === "denied" ? ShieldOff : AlertTriangle;
  const isTransient = kind === "error";
  const title = kind === "denied" ? "Admin Access Unavailable" : "Admin Verification Temporarily Failed";
  const guidance = kind === "denied"
    ? "Your role may have been revoked, or this session belongs to a non-admin account."
    : "This usually means the admin verification Edge Function or network request failed. Your session has not been signed out.";

  return (
    <div
      className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-2">
        {title}
      </h1>
      <div className="mb-6 max-w-md space-y-2">
        <p className="text-muted-foreground">{message}</p>
        <p className="text-sm text-muted-foreground">{guidance}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Retry Verification
        </Button>
        {isTransient ? (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload Tab
          </Button>
        ) : null}
        <Button variant="outline" onClick={onSignOut}>
          Sign Out
        </Button>
      </div>
    </div>
  );
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireOnboarding = true
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, session, isOfflineAtBoot, entryState, entryStateLoading, isProfileLoading, logout } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Server-side admin role verification via edge function - cannot be bypassed
  const {
    data: adminVerification,
    error: adminVerificationError,
    isLoading: isAdminCheckLoading,
    isFetching: isAdminCheckFetching,
    refetch: refetchAdminVerification,
  } = useQuery<AdminVerificationResult>({
    queryKey: ['verify-admin-role', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) {
        return { isAdmin: false, status: "unauthenticated" };
      }

      try {
        const { data, error } = await supabase.functions.invoke('verify-admin', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (error) {
          const status = functionErrorStatus(error);
          if (status === 401) {
            return { isAdmin: false, status: "unauthenticated", message: "Your admin session expired." };
          }
          if (status === 403) {
            return { isAdmin: false, status: "not_admin", message: "Admin role is required." };
          }
          throw new Error(adminVerificationMessage(error));
        }

        if (data?.isAdmin === true) return { isAdmin: true, status: "admin" };
        return {
          isAdmin: false,
          status: data?.status === "unauthenticated" ? "unauthenticated" : "not_admin",
          message: typeof data?.message === "string" ? data.message : "Admin role is required.",
        };
      } catch (err) {
        throw err instanceof Error ? err : new Error("Admin verification failed.");
      }
    },
    enabled: !!session?.user?.id && requireAdmin,
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: true,
    refetchInterval: requireAdmin ? 60_000 : false,
    retry: 1,
  });

  useEffect(() => {
    if (!requireAdmin || !session?.user?.id) return undefined;

    const userId = session.user.id;
    const channel = supabase
      .channel(`admin-role-watch:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['verify-admin-role', userId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, requireAdmin, session?.user?.id]);

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
  if (requireAdmin && adminVerificationError) {
    return (
      <AdminAccessProblem
        kind="error"
        message={adminVerificationMessage(adminVerificationError)}
        isRetrying={isAdminCheckFetching}
        onRetry={() => void refetchAdminVerification()}
        onSignOut={() => void logout()}
      />
    );
  }

  if (requireAdmin && adminVerification?.status !== "admin") {
    return (
      <AdminAccessProblem
        kind="denied"
        message={adminVerification?.message ?? "Your current session does not have admin access. Sign in with an admin account to continue."}
        isRetrying={isAdminCheckFetching}
        onRetry={() => void refetchAdminVerification()}
        onSignOut={() => void logout()}
      />
    );
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
      state === 'deletion_requested'
      || state === 'missing_profile'
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
