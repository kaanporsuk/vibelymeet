import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  Lock,
  Mail,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  clearWebPasswordRecoveryState,
  isBrowserRecoveryReturnUrl,
  markWebPasswordRecoveryInvalid,
  markWebPasswordRecoverySuccess,
  readWebPasswordRecoveryState,
  subscribeWebPasswordRecoveryState,
  type WebPasswordRecoveryState,
} from "@/lib/webPasswordRecovery";

type ResetMode = "request" | "update" | "success";
type SuccessKind = "request" | "update";

const ResetPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const successKindRef = useRef<SuccessKind | null>(null);

  const [mode, setMode] = useState<ResetMode>("request");
  const [successKind, setSuccessKind] = useState<SuccessKind | null>(null);
  const [recoveryState, setRecoveryState] = useState<WebPasswordRecoveryState>(
    () => readWebPasswordRecoveryState(),
  );
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const currentUrlShowsRecoveryReturn = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isBrowserRecoveryReturnUrl(window.location.href);
  }, [location.pathname, location.search, location.hash]);

  const syncRecoveryState = useCallback(async () => {
    const nextRecoveryState = readWebPasswordRecoveryState();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setRecoveryState(nextRecoveryState);
    setHasActiveSession(!!session?.user);

    if (nextRecoveryState.status === "success") {
      successKindRef.current = "update";
      setSuccessKind("update");
      setMode("success");
      return;
    }

    if (successKindRef.current) return;

    if (
      nextRecoveryState.status === "ready"
      && !session?.user
      && !currentUrlShowsRecoveryReturn
    ) {
      markWebPasswordRecoveryInvalid(
        "We couldn't keep that recovery session active. Request a fresh reset email to continue.",
      );
      return;
    }

    if (nextRecoveryState.status === "ready" && session?.user) {
      setMode("update");
      return;
    }

    setMode("request");
  }, [currentUrlShowsRecoveryReturn]);

  useEffect(() => {
    void syncRecoveryState();

    const unsubscribeRecoveryState = subscribeWebPasswordRecoveryState((nextState) => {
      setRecoveryState(nextState);
      void syncRecoveryState();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "PASSWORD_RECOVERY"
        || event === "SIGNED_IN"
        || event === "TOKEN_REFRESHED"
        || event === "USER_UPDATED"
      ) {
        void syncRecoveryState();
      }
    });

    return () => {
      unsubscribeRecoveryState();
      subscription.unsubscribe();
    };
  }, [syncRecoveryState]);

  const handleRequestReset = async () => {
    if (!email.trim()) {
      setFormError("Please enter your email");
      return;
    }

    setIsLoading(true);
    setFormError("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setFormError(error.message);
        return;
      }

      successKindRef.current = "request";
      setSuccessKind("request");
      setMode("success");
      clearWebPasswordRecoveryState();
      setRecoveryState(readWebPasswordRecoveryState());
      toast.success("Password reset email sent. Check your inbox.");
    } catch {
      setFormError("Failed to send reset email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      setFormError("Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      setFormError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    setFormError("");

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setFormError(error.message);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      successKindRef.current = "update";
      setSuccessKind("update");
      setMode("success");
      markWebPasswordRecoverySuccess(session?.user?.id ?? recoveryState.userId);
      setRecoveryState(readWebPasswordRecoveryState());
      setPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully.");
    } catch {
      setFormError("Failed to update password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "request") {
      void handleRequestReset();
      return;
    }
    if (mode === "update") {
      void handleUpdatePassword();
    }
  };

  const handleReturnToSignIn = async () => {
    clearWebPasswordRecoveryState();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.auth.signOut();
      }
    } catch {
      // Best effort: fall through to sign-in regardless.
    }
    navigate("/auth", { replace: true });
  };

  const handleContinueToApp = () => {
    clearWebPasswordRecoveryState();
    navigate("/", { replace: true });
  };

  const showRecoveryLoader =
    !successKind
    && (
      currentUrlShowsRecoveryReturn
      || (recoveryState.status === "ready" && mode !== "update")
    );

  const title = showRecoveryLoader
    ? "Preparing Reset Link"
    : mode === "update"
      ? "Set New Password"
      : mode === "success"
        ? successKind === "update"
          ? "Password Updated"
          : "Check Your Email"
        : recoveryState.status === "invalid"
          ? "Reset Link Expired"
          : "Reset Password";

  const description = showRecoveryLoader
    ? "We're securing your recovery session so you can set a new password without signing in first."
    : mode === "update"
      ? "Choose a new password for your account. Your current password is not required in recovery mode."
      : mode === "success"
        ? successKind === "update"
          ? "Your password has been updated. You can continue into Vibely or return to sign in."
          : "We sent a reset link to your email. Open it on this device to finish resetting your password."
        : recoveryState.status === "invalid"
          ? "That password reset link is invalid, expired, or already used. Request a fresh reset email below."
          : "Enter your email and we'll send you a secure password reset link.";

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0">
        <motion.div
          className="absolute inset-0 opacity-40"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, hsl(var(--neon-violet) / 0.4), transparent),
              radial-gradient(ellipse 60% 40% at 80% 60%, hsl(var(--neon-cyan) / 0.3), transparent),
              radial-gradient(ellipse 50% 30% at 50% 80%, hsl(var(--neon-pink) / 0.2), transparent)
            `,
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          <motion.div
            className="text-center space-y-3"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center neon-glow-violet">
              <Sparkles className="w-10 h-10 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-display font-bold gradient-text">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
          </motion.div>

          {showRecoveryLoader && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-8 text-center space-y-4"
            >
              <div className="w-14 h-14 mx-auto rounded-full bg-primary/15 flex items-center justify-center">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Finishing your recovery link and preparing the secure password form...
              </p>
            </motion.div>
          )}

          {!showRecoveryLoader && mode === "request" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="glass-card p-6 space-y-4">
                {recoveryState.status === "invalid" && recoveryState.error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-3"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>{recoveryState.error}</p>
                  </motion.div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFormError("");
                    }}
                    placeholder="you@example.com"
                    className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                  />
                </div>

                {formError && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm text-destructive text-center"
                  >
                    {formError}
                  </motion.p>
                )}
              </div>

              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full h-14 text-lg font-semibold"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          )}

          {mode === "update" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="glass-card p-6 space-y-4">
                <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-foreground">
                  Recovery mode is active. Set a new password below without entering your current password.
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    New Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFormError("");
                    }}
                    placeholder="••••••••"
                    className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    Confirm Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setFormError("");
                    }}
                    placeholder="••••••••"
                    className="h-12 bg-secondary/50 border-border focus:border-primary focus:ring-primary/20"
                  />
                </div>

                {formError && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm text-destructive text-center"
                  >
                    {formError}
                  </motion.p>
                )}
              </div>

              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full h-14 text-lg font-semibold"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          )}

          {mode === "success" && successKind === "request" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-8 text-center space-y-4"
            >
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <Check className="w-8 h-8 text-white" />
              </div>
              <p className="text-muted-foreground">
                We&apos;ve sent a password reset link to{" "}
                <strong className="text-foreground">{email}</strong>.
                Open it on this device to continue.
              </p>
            </motion.div>
          )}

          {mode === "success" && successKind === "update" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-8 text-center space-y-4"
            >
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <Check className="w-8 h-8 text-white" />
              </div>
              <p className="text-muted-foreground">
                Your password is updated and your account is ready to continue.
              </p>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="gradient"
                  size="lg"
                  className="w-full h-12"
                  onClick={handleContinueToApp}
                >
                  Continue to Vibely
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full h-12"
                  onClick={() => {
                    void handleReturnToSignIn();
                  }}
                >
                  Back to Sign In
                </Button>
              </div>
            </motion.div>
          )}

          {!showRecoveryLoader && mode !== "success" && (
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1 mx-auto"
                onClick={() => {
                  if (hasActiveSession) {
                    navigate("/", { replace: true });
                    return;
                  }
                  navigate("/auth", { replace: true });
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                {hasActiveSession ? "Continue to Vibely" : "Back to Sign In"}
              </button>
            </div>
          )}

          {!showRecoveryLoader && mode === "success" && successKind === "request" && (
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1 mx-auto"
                onClick={() => {
                  if (hasActiveSession) {
                    navigate("/", { replace: true });
                    return;
                  }
                  navigate("/auth", { replace: true });
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                {hasActiveSession ? "Continue to Vibely" : "Back to Sign In"}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ResetPassword;
