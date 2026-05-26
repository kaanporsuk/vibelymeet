import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Lock, LogOut, Mail, RefreshCw, Shield, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { adminToast } from "@/lib/adminToast";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

type AdminSessionVerification =
  | { status: "admin" }
  | { status: "not_admin"; message: string }
  | { status: "revoked"; message: string }
  | { status: "unauthenticated"; message: string }
  | { status: "verification_failed"; message: string };

function functionErrorStatus(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof context === "object") {
    const status = (context as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

const verifyAdminSession = async (accessToken?: string | null) => {
  if (!accessToken) {
    return { status: "unauthenticated", message: "Admin session is required." } satisfies AdminSessionVerification;
  }

  try {
    const { data, error } = await supabase.functions.invoke("verify-admin", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (error) {
      const status = functionErrorStatus(error);
      if (status === 401) {
        return { status: "unauthenticated", message: "Your session expired. Sign in again." } satisfies AdminSessionVerification;
      }
      if (status === 403) {
        return { status: "not_admin", message: "This account does not have admin privileges." } satisfies AdminSessionVerification;
      }
      return { status: "verification_failed", message: "Could not verify admin access. Try again." } satisfies AdminSessionVerification;
    }

    if (data?.isAdmin === true) return { status: "admin" } satisfies AdminSessionVerification;
    if (data?.status === "revoked") {
      return {
        status: "revoked",
        message: typeof data?.message === "string" ? data.message : "Admin access was revoked for this account.",
      } satisfies AdminSessionVerification;
    }
    return {
      status: data?.status === "unauthenticated" ? "unauthenticated" : "not_admin",
      message: typeof data?.message === "string" ? data.message : "This account does not have admin privileges.",
    } satisfies AdminSessionVerification;
  } catch {
    return { status: "verification_failed", message: "Could not reach admin verification. Try again." } satisfies AdminSessionVerification;
  }
};

const signOutCurrentSession = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [existingSessionCheckError, setExistingSessionCheckError] = useState<string | null>(null);

  useEffect(() => {
    // Check if already logged in as admin
    const checkExistingSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const verification = await verifyAdminSession(session.access_token);
          if (verification.status === "admin") {
            navigate('/kaan/dashboard');
            return;
          }
          if (
            verification.status === "not_admin" ||
            verification.status === "revoked" ||
            verification.status === "unauthenticated"
          ) {
            try {
              await signOutCurrentSession();
            } catch (signOutError) {
              const clearMessage = resolveAdminErrorMessage(
                signOutError,
                "Could not clear the current session. Try signing out again before continuing.",
              );
              setExistingSessionCheckError(`${verification.message} ${clearMessage}`);
              adminToast.error({
                id: "admin-login-existing-session-clear-failed",
                title: "Could not sign out",
                description: clearMessage,
              });
              return;
            }
            adminToast.error({
              id: "admin-login-existing-session-denied",
              title: "Admin access required",
              description: verification.message,
            });
          } else {
            adminToast.error({
              id: "admin-login-existing-session-verify-failed",
              title: "Admin verification failed",
              description: verification.message,
            });
            setExistingSessionCheckError(verification.message);
          }
        }
      } catch {
        adminToast.error({
          id: "admin-login-session-check-failed",
          title: "Admin session check failed",
        });
        setExistingSessionCheckError("Could not verify the current session. Retry verification or sign out before continuing.");
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkExistingSession();
  }, [navigate]);

  const signOutExistingSession = async () => {
    setIsLoading(true);
    try {
      await signOutCurrentSession();
      setExistingSessionCheckError(null);
      adminToast.success({
        id: "admin-login-existing-session-cleared",
        title: "Session cleared",
      });
    } catch (err) {
      adminToast.error({
        id: "admin-login-existing-session-clear-failed",
        title: "Could not sign out",
        description: resolveAdminErrorMessage(err, "Could not clear the current session. Try again."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        adminToast.error({
          id: "admin-login-auth-failed",
          title: "Login failed",
          description: resolveAdminErrorMessage(error, "Admin login failed."),
        });
        setIsLoading(false);
        return;
      }

      if (data.user) {
        const verification = await verifyAdminSession(data.session?.access_token);
        if (verification.status !== "admin") {
          try {
            await signOutCurrentSession();
          } catch (signOutError) {
            const clearMessage = resolveAdminErrorMessage(
              signOutError,
              "Could not clear the non-admin session. Try signing out again before continuing.",
            );
            setExistingSessionCheckError(`${verification.message} ${clearMessage}`);
            adminToast.error({
              id: "admin-login-access-denied-clear-failed",
              title: "Access denied",
              description: clearMessage,
            });
            setIsLoading(false);
            return;
          }
          adminToast.error({
            id: verification.status === "verification_failed" ? "admin-login-verify-failed" : "admin-login-access-denied",
            title: verification.status === "verification_failed" ? "Could not verify access" : "Access Denied",
            description: verification.message,
          });
          setIsLoading(false);
          return;
        }

        adminToast.success({
          id: "admin-login-success",
          title: "Welcome back, Admin!",
        });
        navigate('/kaan/dashboard');
      }
    } catch (err) {
      adminToast.error({
        id: "admin-login-unexpected-error",
        title: "An error occurred",
        description: resolveAdminErrorMessage(err, "Admin login failed."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (existingSessionCheckError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card p-8 rounded-3xl text-center" role="alert" aria-live="assertive">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground">
            Could not verify current session
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {existingSessionCheckError}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button className="flex-1" onClick={() => window.location.reload()} disabled={isLoading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
            <Button className="flex-1" variant="outline" onClick={signOutExistingSession} disabled={isLoading}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent mb-4 neon-glow-violet"
          >
            <Shield className="w-10 h-10 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold font-display text-foreground">
            Admin Portal
          </h1>
          <p className="text-muted-foreground mt-2">
            Vibely Command Center
          </p>
        </div>

        {/* Login Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card p-8 rounded-3xl"
        >
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Admin Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@vibely.com"
                  className="pl-11 bg-secondary/50 border-border h-12"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-11 pr-11 bg-secondary/50 border-border h-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity text-white font-semibold"
            >
              {isLoading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                />
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  Access Dashboard
                </span>
              )}
            </Button>
          </form>

          {/* Security Notice */}
          <div className="mt-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-center text-muted-foreground">
              Secure admin-only area. Access is verified server-side before dashboard entry.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
