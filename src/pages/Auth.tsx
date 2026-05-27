import { useEffect, useMemo, useRef, useState } from "react";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
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
import { AuthTurnstile } from "@/components/auth/AuthTurnstile";
import { webTurnstileEnabled } from "@/lib/authTurnstile";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { useAuth } from "@/contexts/AuthContext";
import { ensureProfileReady } from "@/lib/profileBootstrap";
import { buildPhoneE164, isValidSignInPhone } from "@/lib/phoneSignInNormalize";
import {
  mapAuthConflictError,
  parseOAuthCallbackErrorDescription,
} from "@shared/authConflictMessages";
import { applyBrowserReferralAttribution, captureBrowserReferral } from "@/lib/referrals";
import { validatePasswordPolicy, passwordPolicyMessage } from "@clientShared/passwordPolicy";
import { mapPhoneOtpSendError, safeAuthErrorMessage } from "@clientShared/authErrorCopy";
import { formatAuthCooldown, nextAuthOtpCooldownSeconds } from "@clientShared/authOtpCooldown";

type AuthView =
  | "welcome"
  | "otp"
  | "email_signin"
  | "email_signup"
  | "email_signup_pending"
  | "success";

type WebOAuthProvider = "google" | "apple";

const WEB_OAUTH_PROVIDER_STORAGE_KEY = "vibely.pending_oauth_provider";
const WEB_OAUTH_PROVIDER_COOKIE = "vibely_pending_oauth_provider";
const WEB_AUTH_NEXT_STORAGE_KEY = "vibely.auth_next_path";
const WEB_AUTH_NEXT_COOKIE = "vibely_auth_next_path";
const WEB_OAUTH_CALLBACK_TIMEOUT_MS = 5_000;
const WEB_OAUTH_PROVIDER_CONTEXT_TTL_SECONDS = 5 * 60;
const WEB_AUTH_NEXT_TTL_SECONDS = 10 * 60;

function getAuthErrorMessage(error: unknown, fallback: string): string {
  return safeAuthErrorMessage(error, fallback);
}

function isWebOAuthProvider(value: string | null): value is WebOAuthProvider {
  return value === "google" || value === "apple";
}

function readStoredOAuthProvider(): WebOAuthProvider | null {
  try {
    const value = window.sessionStorage.getItem(WEB_OAUTH_PROVIDER_STORAGE_KEY);
    if (isWebOAuthProvider(value)) return value;
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  return readOAuthProviderCookie();
}

function storeOAuthProvider(provider: WebOAuthProvider) {
  try {
    window.sessionStorage.setItem(WEB_OAUTH_PROVIDER_STORAGE_KEY, provider);
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  writeOAuthProviderCookie(provider);
}

function clearStoredOAuthProvider() {
  try {
    window.sessionStorage.removeItem(WEB_OAUTH_PROVIDER_STORAGE_KEY);
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  clearOAuthProviderCookie();
}

function normalizeAuthNextPath(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (normalized === "/" || normalized.startsWith("/auth") || normalized.startsWith("/reset-password")) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function storeAuthNextPath(path: string | null) {
  const normalized = normalizeAuthNextPath(path);
  if (!normalized) {
    clearStoredAuthNextPath();
    return;
  }
  try {
    window.sessionStorage.setItem(WEB_AUTH_NEXT_STORAGE_KEY, normalized);
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  writeAuthNextPathCookie(normalized);
}

function readStoredAuthNextPath(): string | null {
  try {
    const value = normalizeAuthNextPath(window.sessionStorage.getItem(WEB_AUTH_NEXT_STORAGE_KEY));
    if (value) return value;
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  return readAuthNextPathCookie();
}

function clearStoredAuthNextPath() {
  try {
    window.sessionStorage.removeItem(WEB_AUTH_NEXT_STORAGE_KEY);
  } catch {
    /* sessionStorage can be unavailable in hardened browser modes. */
  }
  clearAuthNextPathCookie();
}

function readAuthNextPathCookie(): string | null {
  try {
    const pair = document.cookie
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(`${WEB_AUTH_NEXT_COOKIE}=`));
    if (!pair) return null;
    return normalizeAuthNextPath(decodeURIComponent(pair.slice(WEB_AUTH_NEXT_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

function writeAuthNextPathCookie(path: string) {
  try {
    const secure = window.location.protocol === "https:" ? "Secure" : "";
    document.cookie = [
      `${WEB_AUTH_NEXT_COOKIE}=${encodeURIComponent(path)}`,
      "Path=/auth",
      `Max-Age=${WEB_AUTH_NEXT_TTL_SECONDS}`,
      "SameSite=Lax",
      secure,
    ].filter(Boolean).join("; ");
  } catch {
    /* Cookies can be unavailable in hardened browser modes. */
  }
}

function clearAuthNextPathCookie() {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${WEB_AUTH_NEXT_COOKIE}=; Path=/auth; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* Cookies can be unavailable in hardened browser modes. */
  }
}

function getCallbackProvider(search: string): WebOAuthProvider | null {
  const params = new URLSearchParams(search || "");
  const provider = params.get("provider");
  return isWebOAuthProvider(provider) ? provider : null;
}

function readOAuthProviderCookie(): WebOAuthProvider | null {
  try {
    const pair = document.cookie
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(`${WEB_OAUTH_PROVIDER_COOKIE}=`));
    if (!pair) return null;
    const value = decodeURIComponent(pair.slice(WEB_OAUTH_PROVIDER_COOKIE.length + 1));
    return isWebOAuthProvider(value) ? value : null;
  } catch {
    return null;
  }
}

function writeOAuthProviderCookie(provider: WebOAuthProvider) {
  try {
    const secure = window.location.protocol === "https:" ? "Secure" : "";
    document.cookie = [
      `${WEB_OAUTH_PROVIDER_COOKIE}=${encodeURIComponent(provider)}`,
      "Path=/auth",
      `Max-Age=${WEB_OAUTH_PROVIDER_CONTEXT_TTL_SECONDS}`,
      "SameSite=Lax",
      secure,
    ].filter(Boolean).join("; ");
  } catch {
    /* Cookies can be unavailable in hardened browser modes. */
  }
}

function clearOAuthProviderCookie() {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${WEB_OAUTH_PROVIDER_COOKIE}=; Path=/auth; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* Cookies can be unavailable in hardened browser modes. */
  }
}

function getWebOAuthRedirectUrl(provider: WebOAuthProvider): string {
  const redirectUrl = new URL("/auth", window.location.origin);
  redirectUrl.searchParams.set("provider_callback", "true");
  redirectUrl.searchParams.set("provider", provider);
  return redirectUrl.toString();
}

function waitForOAuthSession(timeoutMs = WEB_OAUTH_CALLBACK_TIMEOUT_MS): Promise<SupabaseSession | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const finish = (session: SupabaseSession | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      unsubscribe?.();
      resolve(session);
    };

    timeout = setTimeout(() => finish(null), timeoutMs);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) finish(session);
    });
    unsubscribe = () => subscription.unsubscribe();
    if (settled) {
      unsubscribe();
    }

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session?.user) finish(session);
      })
      .catch(() => undefined);
  });
}

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { session, entryState, entryStateLoading } = useAuth();
  const sessionUser = session?.user ?? null;
  const pendingOAuthProviderRef = useRef<WebOAuthProvider | null>(null);
  const preserveAuthNextOnAuthScrubRef = useRef(false);

  const [view, setView] = useState<AuthView>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState(() => getDefaultCountryCode());
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneForOtp, setPhoneForOtp] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [phoneSendAttempts, setPhoneSendAttempts] = useState(0);
  const [phoneSendCooldownRemaining, setPhoneSendCooldownRemaining] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [phoneCaptchaToken, setPhoneCaptchaToken] = useState("");
  const [phoneCaptchaResetSignal, setPhoneCaptchaResetSignal] = useState(0);
  const [phoneResendCaptchaToken, setPhoneResendCaptchaToken] = useState("");
  const [phoneResendCaptchaResetSignal, setPhoneResendCaptchaResetSignal] = useState(0);
  const [profileBootstrapState, setProfileBootstrapState] = useState<
    "idle" | "ensuring" | "ready" | "failed"
  >("idle");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const [emailResendAttempts, setEmailResendAttempts] = useState(0);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);
  const [emailResendMessage, setEmailResendMessage] = useState<string | null>(null);
  const [emailSignInCaptchaToken, setEmailSignInCaptchaToken] = useState("");
  const [emailSignInCaptchaResetSignal, setEmailSignInCaptchaResetSignal] = useState(0);
  const [emailSignUpCaptchaToken, setEmailSignUpCaptchaToken] = useState("");
  const [emailSignUpCaptchaResetSignal, setEmailSignUpCaptchaResetSignal] = useState(0);
  const [emailResendCaptchaToken, setEmailResendCaptchaToken] = useState("");
  const [emailResendCaptchaResetSignal, setEmailResendCaptchaResetSignal] = useState(0);

  const isPhoneValid = useMemo(
    () => isValidSignInPhone(countryCode, phoneInput).valid,
    [countryCode, phoneInput]
  );

  const fullPhone = useMemo(
    () => buildPhoneE164(countryCode, phoneInput),
    [countryCode, phoneInput]
  );
  const sessionExpiredMessage =
    searchParams.get("reason") === "session_expired"
      ? "Your session expired. Sign in again to continue."
      : null;
  const premiumCheckoutMessage =
    searchParams.get("reason") === "premium_checkout"
      ? "Sign in to continue with Premium."
      : null;
  const authReasonMessage = sessionExpiredMessage ?? premiumCheckoutMessage;
  const authCaptchaRequired = webTurnstileEnabled();

  const resetPhoneCaptcha = () => {
    setPhoneCaptchaToken("");
    setPhoneCaptchaResetSignal((value) => value + 1);
  };

  const resetPhoneResendCaptcha = () => {
    setPhoneResendCaptchaToken("");
    setPhoneResendCaptchaResetSignal((value) => value + 1);
  };

  const resetEmailSignInCaptcha = () => {
    setEmailSignInCaptchaToken("");
    setEmailSignInCaptchaResetSignal((value) => value + 1);
  };

  const resetEmailSignUpCaptcha = () => {
    setEmailSignUpCaptchaToken("");
    setEmailSignUpCaptchaResetSignal((value) => value + 1);
  };

  const resetEmailResendCaptcha = () => {
    setEmailResendCaptchaToken("");
    setEmailResendCaptchaResetSignal((value) => value + 1);
  };

  useEffect(() => {
    const authReturnError = searchParams.get("auth_error");
    if (!authReturnError) return;

    setError(safeAuthErrorMessage({ message: authReturnError }, "Could not complete sign-in. Try again."));
    setView("welcome");
    setOtpError(null);

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("auth_error");
    const nextSearch = nextParams.toString();
    navigate(nextSearch ? `/auth?${nextSearch}` : "/auth", { replace: true });
  }, [location.search, navigate, searchParams]);

  // Track auth page view + preserve referral
  useEffect(() => {
    trackEvent("auth_page_viewed", { platform: "web" });
    captureBrowserReferral(searchParams);
  }, [searchParams]);

  useEffect(() => {
    const nextPath = searchParams.get("next");
    if (nextPath) {
      storeAuthNextPath(nextPath);
      return;
    }
    if (searchParams.get("provider_callback") !== "true") {
      if (preserveAuthNextOnAuthScrubRef.current) {
        preserveAuthNextOnAuthScrubRef.current = false;
        return;
      }
      clearStoredAuthNextPath();
    }
  }, [searchParams]);

  // OAuth return: surface provider errors; confirm session after success redirect
  useEffect(() => {
    const search = location.search || "";
    const hash = location.hash || "";
    const callbackProvider =
      getCallbackProvider(search) ?? readStoredOAuthProvider() ?? pendingOAuthProviderRef.current;
    const oauthErr = parseOAuthCallbackErrorDescription(search, hash);
    if (oauthErr) {
      const prov = callbackProvider ?? "google";
      const ctx = prov === "apple" ? "apple" : "google";
      const { message } = mapAuthConflictError({ message: oauthErr }, ctx);
      setError(message || safeAuthErrorMessage({ message: oauthErr }, "Could not complete sign-in. Try again."));
      setView("welcome");
      setOtpError(null);
      pendingOAuthProviderRef.current = null;
      clearStoredOAuthProvider();
      preserveAuthNextOnAuthScrubRef.current = true;
      navigate("/auth", { replace: true });
      return;
    }

    const params = new URLSearchParams(search);
    if (params.get("provider_callback") !== "true") return;

    let cancelled = false;
    void (async () => {
      const code = params.get("code");
      let exchangeError: unknown = null;
      let callbackSession: SupabaseSession | null = null;

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (data.session?.user) {
          callbackSession = data.session;
        } else if (error) {
          exchangeError = error;
        }
      }

      const s = callbackSession ?? await waitForOAuthSession();
      if (cancelled) return;
      const oauthProv = callbackProvider;
      pendingOAuthProviderRef.current = null;
      clearStoredOAuthProvider();
      if (s?.user) {
        setView("success");
        trackEvent("auth_method_selected", { method: "oauth_callback", platform: "web" });
      } else {
        const hashErr = parseOAuthCallbackErrorDescription("", hash);
        if (exchangeError) {
          const ctx = oauthProv === "apple" ? "apple" : "google";
          const { message } = mapAuthConflictError(exchangeError, ctx);
          setError(message || safeAuthErrorMessage(exchangeError, "Could not complete sign-in. Try again."));
        } else if (hashErr) {
          const ctx = oauthProv === "apple" ? "apple" : "google";
          const { message } = mapAuthConflictError({ message: hashErr }, ctx);
          setError(message || safeAuthErrorMessage({ message: hashErr }, "Could not complete sign-in. Try again."));
        } else {
          setError("Could not complete sign-in. Try again.");
        }
        setView("welcome");
      }
      if (search.includes("provider_callback") || hash.length > 1) {
        preserveAuthNextOnAuthScrubRef.current = true;
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

  // Countdown for phone first-send failures
  useEffect(() => {
    if (phoneSendCooldownRemaining <= 0) return;
    const id = setInterval(() => {
      setPhoneSendCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [phoneSendCooldownRemaining]);

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
        if (cancelled) return;
        if (
          !cancelled &&
          referralResult.status === "rpc-failed"
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
        ? readStoredAuthNextPath() ?? "/home"
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
      clearStoredAuthNextPath();
      navigate(nextPath, { replace: true });
    }, delay);
    return () => clearTimeout(timer);
  }, [sessionUser, view, navigate, profileBootstrapState, entryState, entryStateLoading]);

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail || emailResendCooldown > 0) return;
    if (authCaptchaRequired && !emailResendCaptchaToken) {
      setEmailResendMessage("Complete verification to resend.");
      return;
    }
    const captchaToken = emailResendCaptchaToken || undefined;
    setEmailResendMessage(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) throw error;
      const attempt = emailResendAttempts + 1;
      setEmailResendAttempts(attempt);
      setEmailResendCooldown(nextAuthOtpCooldownSeconds(attempt));
      setEmailResendMessage("Email sent again. Check your inbox.");
    } catch (err: unknown) {
      const attempt = emailResendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(attempt, err);
      setEmailResendAttempts(attempt);
      setEmailResendCooldown(cooldown);
      setEmailResendMessage(`Could not resend. Try again in ${formatAuthCooldown(cooldown)}.`);
    } finally {
      if (captchaToken) resetEmailResendCaptcha();
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async () => {
    if (!isPhoneValid || phoneSendCooldownRemaining > 0) return;
    if (authCaptchaRequired && !phoneCaptchaToken) {
      setError("Complete verification to continue.");
      return;
    }
    const captchaToken = phoneCaptchaToken || undefined;
    setLoading(true);
    setError(null);
    setOtpError(null);
    trackEvent("auth_method_selected", { method: "phone", platform: "web" });
    trackEvent("auth_phone_submitted", { platform: "web" });
    recordUserAction("auth_phone_submit_clicked", { surface: "auth" });

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) throw error;
      recordUserAction("auth_phone_otp_sent", { surface: "auth" });
      setPhoneForOtp(fullPhone);
      setView("otp");
      setPhoneSendAttempts(0);
      setPhoneSendCooldownRemaining(0);
      setResendAttempts(0);
      setResendRemaining(60);
    } catch (err: unknown) {
      recordUserAction("auth_phone_otp_send_failed", { surface: "auth" });
      const attempt = phoneSendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(attempt, err);
      setPhoneSendAttempts(attempt);
      setPhoneSendCooldownRemaining(cooldown);
      const conflict = mapAuthConflictError(err, "phone_otp_send");
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(mapPhoneOtpSendError(err));
      }
    } finally {
      if (captchaToken) resetPhoneCaptcha();
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
      recordUserAction("auth_otp_verified", { surface: "auth" });
      setView("success");
    } catch {
      recordUserAction("auth_otp_verify_failed", { surface: "auth" });
      setOtpError("Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!phoneForOtp || resendRemaining > 0) return;
    if (authCaptchaRequired && !phoneResendCaptchaToken) {
      setOtpError("Complete verification to resend.");
      return;
    }
    const captchaToken = phoneResendCaptchaToken || undefined;
    setLoading(true);
    setOtpError(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneForOtp,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) throw error;
      const attempt = resendAttempts + 1;
      setResendAttempts(attempt);
      setResendRemaining(nextAuthOtpCooldownSeconds(attempt));
    } catch (err: unknown) {
      const attempt = resendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(attempt, err);
      setResendAttempts(attempt);
      setResendRemaining(cooldown);
      const conflict = mapAuthConflictError(err, "phone_otp_resend");
      setOtpError(
        conflict.message || mapPhoneOtpSendError(err)
      );
    } finally {
      if (captchaToken) resetPhoneResendCaptcha();
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    pendingOAuthProviderRef.current = "google";
    storeOAuthProvider("google");
    trackEvent("auth_method_selected", { method: "google", platform: "web" });
    trackEvent("auth_social_started", { provider: "google" });
    recordUserAction("auth_social_started", { surface: "auth", provider: "google" });
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getWebOAuthRedirectUrl("google"),
      },
    });
    if (oauthError) {
      pendingOAuthProviderRef.current = null;
      clearStoredOAuthProvider();
      const { message } = mapAuthConflictError(oauthError, "google");
      setError(message || safeAuthErrorMessage(oauthError, "Could not start Google sign-in. Try again."));
    }
  };

  const handleApple = async () => {
    pendingOAuthProviderRef.current = "apple";
    storeOAuthProvider("apple");
    trackEvent("auth_method_selected", { method: "apple", platform: "web" });
    trackEvent("auth_social_started", { provider: "apple" });
    recordUserAction("auth_social_started", { surface: "auth", provider: "apple" });
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: getWebOAuthRedirectUrl("apple"),
      },
    });
    if (oauthError) {
      pendingOAuthProviderRef.current = null;
      clearStoredOAuthProvider();
      const { message } = mapAuthConflictError(oauthError, "apple");
      setError(message || safeAuthErrorMessage(oauthError, "Could not start Apple sign-in. Try again."));
    }
  };

  const handleEmailSignIn = async () => {
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    if (authCaptchaRequired && !emailSignInCaptchaToken) {
      setError("Complete verification to sign in.");
      return;
    }
    const captchaToken = emailSignInCaptchaToken || undefined;
    setLoading(true);
    setError(null);
    trackEvent("auth_method_selected", { method: "email", platform: "web" });
    trackEvent("auth_email_signin", { platform: "web" });
    recordUserAction("auth_email_signin_clicked", { surface: "auth" });

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) throw error;
      recordUserAction("auth_email_signin_succeeded", { surface: "auth" });
      setView("success");
    } catch (err: unknown) {
      recordUserAction("auth_email_signin_failed", { surface: "auth" });
      const conflict = mapAuthConflictError(err, "email_sign_in");
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(getAuthErrorMessage(err, "Invalid email or password"));
      }
    } finally {
      if (captchaToken) resetEmailSignInCaptcha();
      setLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !password || !name) {
      setError("Please fill in all fields");
      return;
    }
    const passwordPolicy = validatePasswordPolicy(password);
    if (!passwordPolicy.valid) {
      setError(passwordPolicy.message ?? passwordPolicyMessage());
      return;
    }
    if (authCaptchaRequired && !emailSignUpCaptchaToken) {
      setError("Complete verification to create your account.");
      return;
    }
    const captchaToken = emailSignUpCaptchaToken || undefined;
    setLoading(true);
    setError(null);
    recordUserAction("auth_email_signup_clicked", { surface: "auth" });

    try {
      const signupEmail = email.trim();
      const redirectUrl = `${window.location.origin}/`;
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { name },
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) throw error;
      if (!data.user) {
        throw new Error("We could not create your account. Please try again.");
      }
      trackEvent("auth_email_signup", { platform: "web" });
      recordUserAction("auth_email_signup_succeeded", { surface: "auth" });
      setPassword("");
      if (data.session?.user) {
        setView("success");
        return;
      }
      setPendingConfirmationEmail(signupEmail);
      setEmailResendAttempts(0);
      setEmailResendCooldown(60);
      setEmailResendMessage(null);
      setView("email_signup_pending");
    } catch (err: unknown) {
      recordUserAction("auth_email_signup_failed", { surface: "auth" });
      const conflict = mapAuthConflictError(err, "email_sign_up");
      if (conflict.message) {
        setError(conflict.message);
        if (conflict.suggestEmailSignIn) {
          setView("email_signin");
        }
      } else {
        setError(getAuthErrorMessage(err, "Sign up failed. Please try again."));
      }
    } finally {
      if (captchaToken) resetEmailSignUpCaptcha();
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
              <AuthTurnstile
                action="web_phone_otp_send"
                onTokenChange={setPhoneCaptchaToken}
                resetSignal={phoneCaptchaResetSignal}
                className="flex justify-center"
              />
              <Button
                type="button"
                onClick={handlePhoneSubmit}
                disabled={
                  !isPhoneValid
                  || loading
                  || phoneSendCooldownRemaining > 0
                  || (authCaptchaRequired && !phoneCaptchaToken)
                }
                className="w-full h-12 text-sm font-semibold bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-400 hover:to-pink-400 border-0"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : phoneSendCooldownRemaining > 0 ? (
                  `Try again in ${formatAuthCooldown(phoneSendCooldownRemaining)}`
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
        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-primary transition-colors text-center"
          onClick={() => navigate("/reset-password")}
        >
          Forgot password?
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
          <>
            <AuthTurnstile
              action="web_phone_otp_resend"
              onTokenChange={setPhoneResendCaptchaToken}
              resetSignal={phoneResendCaptchaResetSignal}
              className="flex justify-center"
            />
            <button
              type="button"
              className="text-primary hover:text-primary/80 disabled:text-muted-foreground"
              onClick={handleResendOtp}
              disabled={loading || (authCaptchaRequired && !phoneResendCaptchaToken)}
            >
              Didn&apos;t get it? Resend code
            </button>
          </>
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
        <AuthTurnstile
          action="web_email_signin"
          onTokenChange={setEmailSignInCaptchaToken}
          resetSignal={emailSignInCaptchaResetSignal}
          className="flex justify-center"
        />
        <Button
          type="button"
          onClick={handleEmailSignIn}
          disabled={loading || (authCaptchaRequired && !emailSignInCaptchaToken)}
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
        <AuthTurnstile
          action="web_email_signup"
          onTokenChange={setEmailSignUpCaptchaToken}
          resetSignal={emailSignUpCaptchaResetSignal}
          className="flex justify-center"
        />
        <Button
          type="button"
          onClick={handleEmailSignUp}
          disabled={loading || (authCaptchaRequired && !emailSignUpCaptchaToken)}
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
          <>
            <AuthTurnstile
              action="web_email_signup_resend"
              onTokenChange={setEmailResendCaptchaToken}
              resetSignal={emailResendCaptchaResetSignal}
              className="flex justify-center"
            />
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground"
              onClick={handleResendConfirmation}
              disabled={loading || (authCaptchaRequired && !emailResendCaptchaToken)}
            >
              Resend confirmation email
            </button>
          </>
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
        {authReasonMessage && view !== "success" && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{authReasonMessage}</span>
          </div>
        )}
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
