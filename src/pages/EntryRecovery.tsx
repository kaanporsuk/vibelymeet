import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ensureProfileReady } from "@/lib/profileBootstrap";
import { getAuthProvider } from "@shared/entryState";

function getRecoveryCopy(state: string) {
  switch (state) {
    case "suspected_fragmented_identity":
      return {
        title: "Try the sign-in method you used before",
        description:
          "This sign-in may not match the account you previously used on Vibely. Try the method you used before to avoid creating a duplicate account.",
        primaryLabel: "Try another sign-in method",
        secondaryLabel: "Retry account check",
      };
    case "missing_profile":
      return {
        title: "We couldn't finish setting up your account",
        description:
          "We could not verify your profile setup yet. Retry setup check or sign out and try signing in again.",
        primaryLabel: "Retry setup check",
        secondaryLabel: "Sign out",
      };
    default:
      return {
        title: "We couldn't verify your account right now",
        description:
          "We could not verify your account state right now. Retry the check or sign out and try again.",
        primaryLabel: "Retry",
        secondaryLabel: "Sign out",
      };
  }
}

const EntryRecovery = () => {
  const navigate = useNavigate();
  const { session, entryState, entryStateLoading, refreshEntryState, logout } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const provider = getAuthProvider(session?.user);

  const recoveryState = entryState?.state ?? "hard_error";
  const copy = useMemo(() => getRecoveryCopy(recoveryState), [recoveryState]);

  useEffect(() => {
    if (!entryState) return;
    if (
      entryState.state !== "missing_profile"
      && entryState.state !== "suspected_fragmented_identity"
      && entryState.state !== "hard_error"
    ) {
      navigate(entryState.route_hint === "app" ? "/home" : "/onboarding", { replace: true });
      return;
    }

    trackEvent("entry_recovery_shown", {
      state: entryState.state,
      reason_code: entryState.reason_code,
      platform: "web",
      provider,
      evaluation_version: entryState.evaluation_version,
    });
  }, [entryState, navigate, provider]);

  const handleRetry = async () => {
    if (!session?.user || isRetrying || isSigningOut) return;

    setIsRetrying(true);
    trackEvent("entry_recovery_retry_clicked", {
      state: entryState?.state ?? "hard_error",
      reason_code: entryState?.reason_code ?? "resolver_exception",
      platform: "web",
      provider,
      evaluation_version: entryState?.evaluation_version ?? 1,
    });

    try {
      await ensureProfileReady(session.user, "web_auth_post_login");
      const nextEntryState = await refreshEntryState();
      if (!nextEntryState) return;
      if (nextEntryState.route_hint === "app") {
        navigate("/home", { replace: true });
        return;
      }
      if (nextEntryState.route_hint === "onboarding") {
        navigate("/onboarding", { replace: true });
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const handleTryAnotherMethod = async () => {
    if (isSigningOut || isRetrying) return;
    setIsSigningOut(true);
    try {
      await logout();
      navigate("/auth", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut || isRetrying) return;
    setIsSigningOut(true);
    try {
      await logout();
      navigate("/auth", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  if (entryStateLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center">
      <div className="relative z-10 w-full max-w-md px-6">
        <div className="space-y-4 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur-sm">
          <h2 className="text-xl font-display font-bold text-foreground">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          <div className="space-y-2">
            {recoveryState === "suspected_fragmented_identity" ? (
              <>
                <Button
                  type="button"
                  className="w-full"
                  onClick={handleTryAnotherMethod}
                  disabled={isSigningOut || isRetrying}
                >
                  {isSigningOut ? "Signing out..." : copy.primaryLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleRetry}
                  disabled={isRetrying || isSigningOut}
                >
                  {isRetrying ? "Checking account..." : copy.secondaryLabel}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  className="w-full"
                  onClick={handleRetry}
                  disabled={isRetrying || isSigningOut}
                >
                  {isRetrying ? "Checking account..." : copy.primaryLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleSignOut}
                  disabled={isSigningOut || isRetrying}
                >
                  {isSigningOut ? "Signing out..." : copy.secondaryLabel}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EntryRecovery;
