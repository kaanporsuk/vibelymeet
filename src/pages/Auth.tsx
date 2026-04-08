import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Mail,
  Phone,
  Sparkles,
} from "lucide-react";
import { CountryCodeSelector, getDefaultCountryCode } from "@/components/CountryCodeSelector";
import { OtpInput } from "@/components/OtpInput";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { ensureProfileReady } from "@/lib/profileBootstrap";
import { buildPhoneE164, isValidSignInPhone } from "@/lib/phoneSignInNormalize";
import {
  mapAuthConflictError,
  parseOAuthCallbackErrorDescription,
} from "@shared/authConflictMessages";
import { applyBrowserReferralAttribution, captureBrowserReferral } from "@/lib/referrals";

type AuthView =
  | "welcome"
  | "otp"
  | "email_signin"
  | "email_signup"
  | "email_signup_pending"
  | "success";

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { session, entryState, entryStateLoading } = useAuth();
  const sessionUser = session?.user ?? null;
  const pendingOAuthProviderRef = useRef<"google" | "apple" | null>(null);

  const [view, setView] = useState<AuthView>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState(() => getDefaultCountryCode());
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneForOtp, setPhoneForOtp] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [profileBootstrapState, setProfileBootstrapState] = useState<
    "idle" | "ensuring" | "ready" | "failed"
  >("idle");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);
  const [emailResendMessage, setEmailResendMessage] = useState<string | null>(null);

  const isPhoneValid = useMemo(
    () => isValidSignInPhone(countryCode, phoneInput).valid,
    [countryCode, phoneInput]
  );

  const fullPhone = useMemo(
    () => buildPhoneE164(countryCode, phoneInput),
    [countryCode, phoneInput]
  );

  // Track auth page view + preserve referral
  useEffect(() => {
    trackEvent("auth_page_viewed", { platform: "web" });
    captureBrowserReferral(searchParams);
  }, [searchParams]);

  // OAuth return: surface provider errors; confirm session after success redirect
  useEffect(() => {
    const search = location.search || "";
    const hash = location.hash || "";
    const oauthErr = parseOAuthCallbackErrorDescription(search, hash);
    if (oauthErr) {
      const prov = pendingOAuthProviderRef.current ?? "google";
      const ctx = prov === "apple" ? "apple" : "google";
      const { message } = mapAuthConflictError({ message: oauthErr }, ctx);
      setError(message || oauthErr);
      setView("welcome");
      setOtpError(null);
      pendingOAuthProviderRef.current = null;
      navigate("/auth", { replace: true });
      return;
    }

    const params = new URLSearchParams(search);
    if (params.get("provider_callback") !== "true") return;

    let cancelled = false;
    void (async () => {
      await new Promise((r) => setTimeout(r, 100));
      const { data: { session: s } } = await supabase.auth.getSession();
      if (cancelled) return;
      const oauthProv = pendingOAuthProviderRef.current;
      pendingOAuthProviderRef.current = null;
      if (s?.user) {
        setView("success");
        trackEvent("auth_method_selected", { method: "oauth_callback", platform: "web" });
      } else {
        const hashErr = parseOAuthCallbackErrorDescription("", hash);
        if (hashErr) {
          const ctx = oauthProv === "apple" ? "apple" : "google";
          const { message } = mapAuthConflictError({ message: hashErr }, ctx);
          setError(message || hashErr);
        } else {
          setError("Could not complete sign-in. Try again.");
        }
        setView("welcome");
      }
      if (search.includes("provider_callback") || hash.length > 1) {
        navigate("/auth", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, location.hash, navigate]);

  // Countdown for OTP resend
  useEffect(() => {
    if (resendRemaining <= 0) return;
    const id = setInterval(() => {
      setResendRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [resendRemaining]);

  // Countdown for email confirmation resend
  useEffect(() => {
    if (emailResendCooldown <= 0) return;
    const id = setInterval(() => {
      setEmailResendCooldown((prev) => {
        const next = prev > 0 ? prev - 1 : 0;
        if (next === 0) setEmailResendMessage(null);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [emailResendCooldown]);

  // Web auth checks backend-owned profile readiness. Hydration contexts stay read-only.
  useEffect(() => {
    if (!sessionUser) {
      setProfileBootstrapState("idle");
      return;
    }

    let cancelled = false;

    const ensureProfileExists = async () => {
      setProfileBootstrapState("ensuring");
      const ensured = await ensureProfileReady(sessionUser, "web_auth_post_login");
      if (cancelled) return;
      if (ensured.status === "ready") {
        const referralResult = await applyBrowserReferralAttribution(sessionUser.id);
        if (
          !cancelled &&
          (referralResult.status === "lookup-failed" || referralResult.status === "update-failed")
        ) {
          console.warn("[referrals] attribution failed", {
            userId: sessionUser.id,
            status: referralResult.status,
            message: referralResult.message,
          });
        }
        setProfileBootstrapState("ready");
        return;
      }
      setProfileBootstrapState("failed");
    };

    void ensureProfileExists();

    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  useEffect(() => {
    if (profileBootstrapState === "failed" && sessionUser) {
      navigate("/entry-recovery", { replace: true });
    }
  }, [profileBootstrapState, sessionUser, navigate]);

  // Redirect after auth — reads entry state from the server-owned resolver.
  useEffect(() => {
    if (!sessionUser || profileBootstrapState !== "ready") return;
    if (entryStateLoading) return;

    const nextPath = !entryState
      ? "/entry-recovery"
      : entryState.route_hint === "app"
        ? "/home"
        : entryState.route_hint === "onboarding"
          ? "/onboarding"
          : "/entry-recovery";

    const delay = view === "success" ? 1500 : 0;
    const timer = setTimeout(() => {
      localStorage.removeItem("vibely_onboarding_progress");
      const savedOnboarding = localStorage.getItem("vibely_onboarding_v2");
      if (savedOnboarding) {
        try {
          const parsed = JSON.parse(savedOnboarding);
          if (parsed.userId && parsed.userId !== sessionUser.id) {
            localStorage.removeItem("vibely_onboarding_v2");
          }
        } catch {
          localStorage.removeItem("vibely_onboarding_v2");
        }
      }
      navigate(nextPath, { replace: true });
    }, delay);
    return () => clearTimeout(timer);
  }, [sessionUser, view, navigate, profileBootstrapState, entryState, entryStateLoading]);

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail || emailResendCooldown > 0) return;
    setEmailResendMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmationEmail,
      });
      if (error) throw error;
      setEmailResendCooldown(60);
      setEmailResendMessage("Email sent again. Check your inbox.");
    } catch {
      setEmailResendMessage("Could not resend. Try again in a moment.");
    }
  };

  const handlePhoneSubmit = async () => {
    if (!isPhoneValid) return;
    setLoading(true);
    setError(null);
    setOtpError(null);
    trackEvent("auth_method_selected", { method: "phone", platform: "web" });
    trackEvent("auth_phone_submitted", { platform: "web" });

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
      });
      if (error) throw error;
      setPhoneForOtp(fullPhone);
      setView("otp");
      setResendAttempts(0);
      setResendRemaining(60);
    } catch (err: any) {
      const conflict = mapAuthConflictError(err, "phone_otp_send");
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(String(err?.message || "Something went wrong. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (code: string) => {
    if (!phoneForOtp) return;
    setLoading(true);
    setOtpError(null);

    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: phoneForOtp,
        token: code,
        type: "sms",
      });
      if (error) throw error;
      trackEvent("auth_otp_verified", { platform: "web" });
      setView("success");
    } catch (err: any) {
      setOtpError("Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!phoneForOtp || resendRemaining > 0) return;
    setLoading(true);
    setOtpError(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneForOtp,
      });
      if (error) throw error;
      const attempt = resendAttempts + 1;
      setResendAttempts(attempt);
      const nextCooldown = attempt === 1 ? 60 : attempt === 2 ? 180 : 900;
      setResendRemaining(nextCooldown);
    } catch (err: any) {
      const conflict = mapAuthConflictError(err, "phone_otp_resend");
      setOtpError(
        conflict.message || "Could not resend code. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    pendingOAuthProviderRef.current = "google";
    trackEvent("auth_method_selected", { method: "google", platform: "web" });
    trackEvent("auth_social_started", { provider: "google" });
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth?provider_callback=true`,
      },
    });
  };

  const handleApple = async () => {
    pendingOAuthProviderRef.current = "apple";
    trackEvent("auth_method_selected", { method: "apple", platform: "web" });
    trackEvent("auth_social_started", { provider: "apple" });
    await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}/auth?provider_callback=true`,
      },
    });
  };

  const handleEmailSignIn = async () => {
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError(null);
    trackEvent("auth_method_selected", { method: "email", platform: "web" });
    trackEvent("auth_email_signin", { platform: "web" });

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setView("success");
    } catch (err: any) {
      const conflict = mapAuthConflictError(err, "email_sign_in");
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(String(err?.message || "Invalid email or password"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !password || !name) {
      setError("Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const signupEmail = email.trim();
      const redirectUrl = `${window.location.origin}/`;
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { name },
        },
      });
      if (error) throw error;
      if (!data.user) {
        throw new Error("We could not create your account. Please try again.");
      }
      trackEvent("auth_email_signup", { platform: "web" });
      setPassword("");
      if (data.session?.user) {
        setView("success");
        return;
      }
      setPendingConfirmationEmail(signupEmail);
      setView("email_signup_pending");
    } catch (err: any) {
      const conflict = mapAuthConflictError(err, "email_sign_up");
      if (conflict.message) {
        setError(conflict.message);
        if (conflict.suggestEmailSignIn) {
          setView("email_signin");
        }
      } else {
        setError(err?.message || "Sign up failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const renderWelcome = () => (
    <motion.div
      key="welcome"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="text-center space-y-3">
        <motion.div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 shadow-[0_0_50px_rgba(168,85,247,0.6)]"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Sparkles className="w-7 h-7 text-white" />
        </motion.div>
        <div className="space-y-1">
          <h1 className="text-3xl font-display font-bold text-foreground">
            Find your vibe
          </h1>
          <p className="text-sm text-muted-foreground">
            Events. Video dates. Real connections.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Phone className="w-3 h-3" />
            Continue with your phone
          </Label>
          <div className="flex gap-2">
            <CountryCodeSelector
              value={countryCode}
              onChange={(code) => {
                setCountryCode(code);
                setError(null);
              }}
            />
            <Input
              type="tel"
              inputMode="tel"
              placeholder="Phone number"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setError(null);
              }}
              className="h-12 flex-1 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1 text-center">{error}</p>
          )}
          <Button
            type="button"
            onClick={handlePhoneSubmit}
            disabled={!isPhoneValid || loading}
            className="w-full h-12 text-sm font-semibold bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-400 hover:to-pink-400 border-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex-1 h-px bg-border" />
          <span>or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 bg-background/40 border-border text-foreground hover:bg-secondary/60"
            onClick={handleGoogle}
          >
            <span className="mr-2 text-lg">🟦</span>
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 bg-background/40 border-border text-foreground hover:bg-secondary/60"
            onClick={handleApple}
          >
            <span className="mr-2 text-lg"></span>
            Continue with Apple
          </Button>
        </div>

        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary transition-colors text-center"
          onClick={() => {
            setView("email_signin");
            setError(null);
            trackEvent("auth_method_selected", { method: "email" });
          }}
        >
          Use email instead
        </button>

        <p className="text-[11px] text-center text-muted-foreground">
          By continuing, you agree to our{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </motion.div>
  );

  const renderOtp = () => (
    <motion.div
      key="otp"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        onClick={() => {
          setView("welcome");
          setOtpError(null);
        }}
      >
        <ArrowLeft className="w-3 h-3" />
        Back
      </button>

      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Enter your code
        </h2>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">{phoneForOtp}</span>
        </p>
      </div>

      <OtpInput onComplete={handleOtpVerify} error={otpError ?? undefined} disabled={loading} />

      <div className="space-y-2 text-center text-xs text-muted-foreground">
        {resendRemaining > 0 ? (
          <p>Resend code in {Math.floor(resendRemaining / 60)}:{`${resendRemaining % 60}`.padStart(2, "0")}</p>
        ) : (
          <button
            type="button"
            className="text-primary hover:text-primary/80"
            onClick={handleResendOtp}
            disabled={loading}
          >
            Didn&apos;t get it? Resend code
          </button>
        )}
        <button
          type="button"
          className="block w-full mt-1 text-xs text-muted-foreground hover:text-primary"
          onClick={() => {
            setView("welcome");
            setOtpError(null);
            setPhoneInput("");
          }}
        >
          Wrong number?
        </button>
      </div>
    </motion.div>
  );

  const renderEmailSignIn = () => (
    <motion.div
      key="email_signin"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        onClick={() => {
          setView("welcome");
          setError(null);
        }}
      >
        <ArrowLeft className="w-3 h-3" />
        Back
      </button>

      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Sign in with email
        </h2>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email-signin" className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input
            id="email-signin"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="you@example.com"
            className="h-11 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password-signin" className="text-xs text-muted-foreground">
            Password
          </Label>
          <Input
            id="password-signin"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="••••••••"
            className="h-11 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
          />
        </div>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
        <Button
          type="button"
          onClick={handleEmailSignIn}
          disabled={loading}
          className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-400 hover:to-pink-400 border-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary"
          onClick={() => navigate("/reset-password")}
        >
          Forgot password?
        </button>
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary"
          onClick={() => {
            setView("email_signup");
            setError(null);
          }}
        >
          Don&apos;t have an account? Create one
        </button>
      </div>
    </motion.div>
  );

  const renderEmailSignUp = () => (
    <motion.div
      key="email_signup"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        onClick={() => {
          setView("welcome");
          setError(null);
        }}
      >
        <ArrowLeft className="w-3 h-3" />
        Back
      </button>

      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Create your account
        </h2>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name-signup" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id="name-signup"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Your name"
            className="h-11 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email-signup" className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input
            id="email-signup"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="you@example.com"
            className="h-11 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password-signup" className="text-xs text-muted-foreground">
            Password
          </Label>
          <Input
            id="password-signup"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="At least 6 characters"
            className="h-11 bg-secondary/60 border-border focus:border-primary focus-visible:ring-primary/30"
          />
        </div>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
        <Button
          type="button"
          onClick={handleEmailSignUp}
          disabled={loading}
          className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-400 hover:to-pink-400 border-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
        </Button>
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary"
          onClick={() => {
            setView("email_signin");
            setError(null);
          }}
        >
          Already have an account? Sign in
        </button>
      </div>
    </motion.div>
  );

  const renderEmailSignUpPending = () => (
    <motion.div
      key="email_signup_pending"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        onClick={() => {
          setView("email_signup");
          setError(null);
        }}
      >
        <ArrowLeft className="w-3 h-3" />
        Back
      </button>

      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Check your email
        </h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">
            {pendingConfirmationEmail || email}
          </span>
          . Open it on this device to finish signing in.
        </p>
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          onClick={() => {
            setView("email_signin");
            setError(null);
          }}
          className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-400 hover:to-pink-400 border-0"
        >
          Back to sign in
        </Button>
        {emailResendMessage && (
          <p className="text-xs text-center text-muted-foreground">{emailResendMessage}</p>
        )}
        {emailResendCooldown > 0 ? (
          <p className="text-xs text-center text-muted-foreground">
            Resend available in {emailResendCooldown}s
          </p>
        ) : (
          <button
            type="button"
            className="w-full text-xs text-muted-foreground hover:text-primary"
            onClick={handleResendConfirmation}
          >
            Resend confirmation email
          </button>
        )}
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary"
          onClick={() => {
            setView("email_signup");
            setError(null);
          }}
        >
          Use a different email
        </button>
      </div>
    </motion.div>
  );

  const renderSuccess = () => (
    <motion.div
      key="success"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center space-y-6"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shadow-[0_0_60px_rgba(168,85,247,0.7)]"
      >
        <Check className="w-12 h-12 text-white" />
      </motion.div>
      <div className="space-y-2">
        <h2 className="text-3xl font-display font-bold text-foreground">
          Welcome to Vibely
        </h2>
        <p className="text-muted-foreground text-sm">
          We&apos;re getting your profile ready…
        </p>
      </div>
    </motion.div>
  );

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
          animate={{
            backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
        />
        <motion.div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 40% at 30% 20%, hsl(var(--neon-cyan) / 0.3), transparent),
              radial-gradient(ellipse 50% 60% at 70% 80%, hsl(var(--neon-violet) / 0.25), transparent)
            `,
          }}
          animate={{
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <AnimatePresence mode="wait">
          {view === "welcome" && renderWelcome()}
          {view === "otp" && renderOtp()}
          {view === "email_signin" && renderEmailSignIn()}
          {view === "email_signup" && renderEmailSignUp()}
          {view === "email_signup_pending" && renderEmailSignUpPending()}
          {view === "success" && renderSuccess()}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Auth;
