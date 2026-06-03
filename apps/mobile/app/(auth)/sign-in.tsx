import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Localization from 'expo-localization';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useNativeLogout } from '@/hooks/useNativeLogout';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { startNativeGoogleOAuth } from '@/lib/nativeGoogleOAuth';
import { requestNativeAuthCaptchaToken } from '@/lib/nativeAuthCaptcha';
import { ensureProfileReady } from '@/lib/profileBootstrap';
import { getNativeEmailSignUpRedirectUrl } from '@/lib/nativeAuthRedirect';
import { getDefaultPhoneCountry, isValidSignInPhone } from '@/lib/phoneSignInNormalize';
import { authErrorDebugInfo, mapPhoneOtpSendError, safeAuthErrorMessage } from '@clientShared/authErrorCopy';
import {
  buildAppleNameMetadataPatch,
  buildAppleSupabaseIdTokenCredentials,
  createAppleAuthNoncePair,
  logAppleNonceDebug,
  summarizeAppleCredentialForDebug,
} from '@/lib/appleAuth';
import { primeCachedSession } from '@/lib/nativeAuthSession';
import { mapAuthConflictError } from '@shared/authConflictMessages';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { validatePasswordPolicy, passwordPolicyMessage } from '@clientShared/passwordPolicy';
import { formatAuthCooldown, nextAuthOtpCooldownSeconds } from '@clientShared/authOtpCooldown';

function errorMessage(error: unknown, fallback: string): string {
  return safeAuthErrorMessage(error, fallback);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : undefined;
}

function errorNativeCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as { nativeErrorCode?: unknown; errorCode?: unknown; code?: unknown };
  const value = record.nativeErrorCode ?? record.errorCode ?? record.code;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function appleAuthErrorDiagnostics(error: unknown): Record<string, string | number | boolean | null> {
  const message = errorMessage(error, '');
  return {
    code: errorCode(error) ?? null,
    nativeCode: errorNativeCode(error) ?? null,
    messagePrefix: message ? message.slice(0, 120) : null,
    authorizationError1001: /AuthorizationError(?:\s+error)?\s+1001|Code=1001/i.test(message),
    akAuthentication7003: /AKAuthenticationError(?:\s+Code=)?-7003|Code=-7003/i.test(message),
  };
}

function isAppleAuthCancelled(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'ERR_REQUEST_CANCELED' || code === '1001') return true;
  if (errorNativeCode(error) === 1001) return true;
  return /AuthorizationError(?:\s+error)?\s+1001|ASAuthorizationController credential request failed/i.test(
    errorMessage(error, ''),
  );
}

/** Dev-only: never log full numbers; keep enough to verify country + length. */
function logPhoneOtpDebug(label: string, e164: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  const safe =
    e164.length <= 8 ? `${e164.slice(0, 3)}…` : `${e164.slice(0, 4)}…${e164.slice(-2)} (${e164.replace(/\D/g, '').length} digits)`;
  console.warn(`[sign-in] ${label}`, { normalizedPhone: safe, ...payload });
}

function addAppleAuthDiagnostic(
  message: string,
  data?: Record<string, string | number | boolean | null | undefined>,
  level: 'info' | 'warning' = 'info',
) {
  try {
    Sentry.addBreadcrumb({
      category: 'auth.apple',
      message,
      level,
      data: data && Object.keys(data).length > 0 ? (data as Record<string, unknown>) : undefined,
    });
  } catch {
    /* Diagnostics must never break auth flows. */
  }

  if (__DEV__) {
    const log = level === 'warning' ? console.warn : console.info;
    log('[auth][apple]', message, data ?? {});
  }
}

type AppleAuthStage =
  | 'captcha'
  | 'nonce'
  | 'apple_authorization'
  | 'supabase_exchange'
  | 'cache_prime'
  | 'metadata_update';

type AppleAuthDiagnosticData = Record<string, string | number | boolean | null | undefined>;

function appleAuthStageTimeoutError(stage: AppleAuthStage, timeoutMs: number): Error {
  const error = new Error(`${stage}_timeout`);
  Object.assign(error, {
    code: 'APPLE_AUTH_STAGE_TIMEOUT',
    stage,
    timeoutMs,
  });
  return error;
}

function isAppleAuthStageTimeout(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'APPLE_AUTH_STAGE_TIMEOUT';
}

function addAppleAuthStageDiagnostic(
  stage: AppleAuthStage,
  status: 'started' | 'completed' | 'failed' | 'timeout' | 'skipped' | 'cancelled',
  data: AppleAuthDiagnosticData = {},
  level: 'info' | 'warning' = status === 'failed' || status === 'timeout' ? 'warning' : 'info',
) {
  addAppleAuthDiagnostic('Stage ' + status, { stage, ...data }, level);
}

function withAppleAuthStageTimeout<T>(
  stage: AppleAuthStage,
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(appleAuthStageTimeoutError(stage, timeoutMs)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function runAppleAuthStage<T>(
  stage: AppleAuthStage,
  operation: () => PromiseLike<T>,
  options: {
    timeoutMs?: number;
    completedData?: (result: T) => AppleAuthDiagnosticData;
    startedData?: AppleAuthDiagnosticData;
  } = {},
): Promise<T> {
  const startedAt = Date.now();
  addAppleAuthStageDiagnostic(stage, 'started', {
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.startedData ?? {}),
  });

  try {
    const result = await (
      options.timeoutMs
        ? withAppleAuthStageTimeout(stage, operation(), options.timeoutMs)
        : operation()
    );
    addAppleAuthStageDiagnostic(stage, 'completed', {
      elapsedMs: Date.now() - startedAt,
      ...(options.completedData ? options.completedData(result) : {}),
    });
    return result;
  } catch (error) {
    const timedOut = isAppleAuthStageTimeout(error);
    const cancelled = stage === 'apple_authorization' && isAppleAuthCancelled(error);
    const diagnostics = appleAuthErrorDiagnostics(error);
    addAppleAuthStageDiagnostic(stage, timedOut ? 'timeout' : cancelled ? 'cancelled' : 'failed', {
      elapsedMs: Date.now() - startedAt,
      ...diagnostics,
    }, timedOut || !cancelled ? 'warning' : 'info');
    throw error;
  }
}

type AuthView =
  | 'welcome'
  | 'otp'
  | 'email_signin'
  | 'email_signup'
  | 'email_signup_pending'
  | 'success';

type Country = { name: string; code: string; flag: string; suggested?: boolean };

const ENTRY_RECOVERY_HREF = '/entry-recovery' as Href;
const NATIVE_APPLE_AUTH_CAPTCHA_TIMEOUT_MS = 30_000;
const NATIVE_APPLE_AUTH_SUPABASE_TIMEOUT_MS = 25_000;
const NATIVE_APPLE_AUTH_METADATA_TIMEOUT_MS = 5_000;

/** Canonical web origin for legal pages (matches `EXPO_PUBLIC_WEB_APP_URL` usage elsewhere). */
const WEB_APP_ORIGIN = (process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://www.vibelymeet.com').replace(/\/$/, '');

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const COUNTRIES: Country[] = [
  { name: 'Poland', code: '+48', flag: '🇵🇱', suggested: true },
  { name: 'Netherlands', code: '+31', flag: '🇳🇱', suggested: true },
  { name: 'Germany', code: '+49', flag: '🇩🇪', suggested: true },
  { name: 'France', code: '+33', flag: '🇫🇷', suggested: true },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧', suggested: true },
  { name: 'Spain', code: '+34', flag: '🇪🇸', suggested: true },
  { name: 'Italy', code: '+39', flag: '🇮🇹', suggested: true },
  { name: 'Türkiye', code: '+90', flag: '🇹🇷', suggested: true },
  { name: 'Sweden', code: '+46', flag: '🇸🇪', suggested: true },
  { name: 'Portugal', code: '+351', flag: '🇵🇹', suggested: true },
  { name: 'United States', code: '+1', flag: '🇺🇸' },
  { name: 'Canada', code: '+1', flag: '🇨🇦' },
  { name: 'Ireland', code: '+353', flag: '🇮🇪' },
  { name: 'Norway', code: '+47', flag: '🇳🇴' },
  { name: 'Denmark', code: '+45', flag: '🇩🇰' },
  { name: 'Belgium', code: '+32', flag: '🇧🇪' },
  { name: 'Austria', code: '+43', flag: '🇦🇹' },
  { name: 'Switzerland', code: '+41', flag: '🇨🇭' },
  { name: 'Finland', code: '+358', flag: '🇫🇮' },
  { name: 'Czechia', code: '+420', flag: '🇨🇿' },
  { name: 'Greece', code: '+30', flag: '🇬🇷' },
  { name: 'Hungary', code: '+36', flag: '🇭🇺' },
  { name: 'Romania', code: '+40', flag: '🇷🇴' },
  { name: 'Bulgaria', code: '+359', flag: '🇧🇬' },
  { name: 'Croatia', code: '+385', flag: '🇭🇷' },
  { name: 'Slovakia', code: '+421', flag: '🇸🇰' },
  { name: 'Slovenia', code: '+386', flag: '🇸🇮' },
  { name: 'Australia', code: '+61', flag: '🇦🇺' },
  { name: 'New Zealand', code: '+64', flag: '🇳🇿' },
  { name: 'Brazil', code: '+55', flag: '🇧🇷' },
  { name: 'Mexico', code: '+52', flag: '🇲🇽' },
  { name: 'Argentina', code: '+54', flag: '🇦🇷' },
  { name: 'Chile', code: '+56', flag: '🇨🇱' },
  { name: 'India', code: '+91', flag: '🇮🇳' },
  { name: 'Pakistan', code: '+92', flag: '🇵🇰' },
  { name: 'Bangladesh', code: '+880', flag: '🇧🇩' },
  { name: 'South Africa', code: '+27', flag: '🇿🇦' },
];

export default function SignInScreen() {
  const theme = Colors[useColorScheme()];
  const params = useLocalSearchParams<{ authError?: string | string[] }>();
  const { session } = useAuth();
  const logout = useNativeLogout();
  const defaultPhoneCountry = useMemo(
    () => getDefaultPhoneCountry(Localization.getLocales()[0]?.regionCode ?? null),
    [],
  );
  const authLinkError = firstRouteParam(params.authError);

  const [view, setView] = useState<AuthView>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState(defaultPhoneCountry.dialCode);
  const [countryName, setCountryName] = useState(defaultPhoneCountry.countryName);
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneForOtp, setPhoneForOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const [phoneSendAttempts, setPhoneSendAttempts] = useState(0);
  const [phoneSendCooldownRemaining, setPhoneSendCooldownRemaining] = useState(0);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');
  const [emailResendAttempts, setEmailResendAttempts] = useState(0);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);
  const [emailResendMessage, setEmailResendMessage] = useState<string | null>(null);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState<boolean | null>(null);
  const [profileBootstrapState, setProfileBootstrapState] = useState<'idle' | 'ensuring' | 'ready' | 'failed'>('idle');
  const [profileBootstrapMessage, setProfileBootstrapMessage] = useState<string | null>(null);
  const handledAuthLinkErrorRef = useRef<string | null>(null);

  const showProfileRecovery = useCallback((message?: string) => {
    setProfileBootstrapState('failed');
    setProfileBootstrapMessage(
      message || 'We could not verify your account setup right now. Retry setup check or sign out and sign in again.',
    );
  }, []);

  const settleProfileBootstrap = useCallback(async () => {
    if (!session?.user) {
      return {
        status: 'failed',
        code: 'profile_lookup_unexpected',
        retryable: false,
        message: 'No authenticated user available for profile readiness check.',
      } as const;
    }

    return ensureProfileReady(session.user, 'sign_in_screen_effect');
  }, [session?.user]);

  const phoneForSignIn = useMemo(() => isValidSignInPhone(countryCode, phoneInput), [countryCode, phoneInput]);
  const phoneValid = phoneForSignIn.valid;
  const selectedCountry = useMemo(
    () =>
      COUNTRIES.find((c) => c.code === countryCode && c.name === countryName) ??
      COUNTRIES.find((c) => c.code === countryCode) ??
      COUNTRIES[0],
    [countryCode, countryName]
  );
  const filteredCountries = useMemo(() => {
    const query = countrySearchQuery.trim().toLowerCase();
    return COUNTRIES.filter((c) => {
      if (!query) return true;
      return c.name.toLowerCase().includes(query) || c.code.includes(query.replace(/\s/g, ''));
    });
  }, [countrySearchQuery]);
  const countrySections = useMemo(() => {
    const suggested = filteredCountries.filter((c) => c.suggested);
    const others = filteredCountries
      .filter((c) => !c.suggested)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      { title: 'Suggested', data: suggested },
      { title: 'All countries', data: others },
    ].filter((section) => section.data.length > 0);
  }, [filteredCountries]);

  useEffect(() => {
    trackEvent('auth_page_viewed', { platform: 'native' });
  }, []);

  useEffect(() => {
    if (resendRemaining <= 0) return;
    const timer = setInterval(() => setResendRemaining((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendRemaining]);

  useEffect(() => {
    if (phoneSendCooldownRemaining <= 0) return;
    const timer = setInterval(() => setPhoneSendCooldownRemaining((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [phoneSendCooldownRemaining]);

  useEffect(() => {
    if (emailResendCooldown <= 0) return;
    const timer = setInterval(() => setEmailResendCooldown((v) => {
      const next = Math.max(0, v - 1);
      if (next === 0) setEmailResendMessage(null);
      return next;
    }), 1000);
    return () => clearInterval(timer);
  }, [emailResendCooldown]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS !== 'ios') {
          if (!cancelled) setAppleSignInAvailable(null);
          return;
        }
        const available = await AppleAuthentication.isAvailableAsync();
        addAppleAuthDiagnostic('Availability checked', { source: 'auth_screen', available });
        if (!cancelled) setAppleSignInAvailable(available);
      } catch {
        addAppleAuthDiagnostic('Availability check failed', { source: 'auth_screen' }, 'warning');
        if (!cancelled) setAppleSignInAvailable(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authLinkError || handledAuthLinkErrorRef.current === authLinkError) return;
    handledAuthLinkErrorRef.current = authLinkError;
    setLoading(false);
    setView('welcome');
    setError(safeAuthErrorMessage({ message: authLinkError }, 'Could not complete sign-in. Try again.'));
  }, [authLinkError]);

  useEffect(() => {
    if (!session?.user?.id) {
      setProfileBootstrapState('idle');
      setProfileBootstrapMessage(null);
      return;
    }

    let cancelled = false;

    const ensureProfileExists = async () => {
      setProfileBootstrapState('ensuring');
      setProfileBootstrapMessage(null);
      const result = await settleProfileBootstrap();
      if (cancelled) return;
      if (result.status === 'ready') {
        setProfileBootstrapState('ready');
        return;
      }
      showProfileRecovery();
    };
    void ensureProfileExists();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, settleProfileBootstrap, showProfileRecovery]);

  useEffect(() => {
    if (!session?.user?.id || profileBootstrapState !== 'ready') return;
    const t = setTimeout(() => {
      router.replace('/');
    }, view === 'success' ? 1200 : 0);
    return () => clearTimeout(t);
  }, [session?.user?.id, view, profileBootstrapState]);

  useEffect(() => {
    if (profileBootstrapState === 'failed' && session?.user) {
      router.replace(ENTRY_RECOVERY_HREF);
    }
  }, [profileBootstrapState, session?.user]);

  const retryProfileSetup = async () => {
    if (!session?.user) return;
    setProfileBootstrapState('ensuring');
    setProfileBootstrapMessage(null);
    const result = await settleProfileBootstrap();
    if (result.status === 'ready') {
      setProfileBootstrapState('ready');
      return;
    }
    showProfileRecovery();
  };

  const signOutFromRecovery = async () => {
    await logout();
    setProfileBootstrapState('idle');
    setProfileBootstrapMessage(null);
    setError(null);
    setView('welcome');
  };

  const handlePhoneSubmit = async () => {
    const { e164, valid } = isValidSignInPhone(countryCode, phoneInput);
    if (!valid) {
      setError('Enter a valid phone number for this country (digits only, no leading 0).');
      return;
    }
    if (phoneSendCooldownRemaining > 0) return;
    setLoading(true);
    setError(null);
    trackEvent('auth_method_selected', { method: 'phone', platform: 'native' });
    trackEvent('auth_phone_submitted', { platform: 'native' });
    try {
      const captcha = await requestNativeAuthCaptchaToken('native_phone_otp_send');
      if (!captcha.ok) {
        setError(captcha.message);
        return;
      }
      const { data, error: otpError } = await supabase.auth.signInWithOtp({
        phone: e164,
        ...(captcha.token ? { options: { captchaToken: captcha.token } } : {}),
      });
      logPhoneOtpDebug('signInWithOtp response', e164, {
        hasError: !!otpError,
        error: otpError ? authErrorDebugInfo(otpError) : null,
        hasData: data != null,
        dataUser: !!data?.user,
        dataSession: !!data?.session,
      });
      if (otpError) throw otpError;
      setPhoneForOtp(e164);
      setOtpDigits(['', '', '', '', '', '']);
      setView('otp');
      setPhoneSendAttempts(0);
      setPhoneSendCooldownRemaining(0);
      setResendAttempts(0);
      setResendRemaining(60);
    } catch (e: unknown) {
      const attempt = phoneSendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(attempt, e);
      setPhoneSendAttempts(attempt);
      setPhoneSendCooldownRemaining(cooldown);
      const conflict = mapAuthConflictError(e, 'phone_otp_send');
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(mapPhoneOtpSendError(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ phone: phoneForOtp, token: code, type: 'sms' });
      if (e) throw e;
      trackEvent('auth_otp_verified', { platform: 'native' });
      setView('success');
    } catch {
      setError('Invalid code. Please try again.');
      setOtpDigits(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleOtpDigit = (idx: number, value: string) => {
    const d = value.replace(/\D/g, '').slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[idx] = d;
      const code = next.join('');
      if (code.length === 6 && !next.includes('')) {
        void verifyOtp(code);
      }
      return next;
    });
    if (d && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const resendOtp = async () => {
    if (!phoneForOtp || resendRemaining > 0) return;
    setLoading(true);
    setError(null);
    try {
      const captcha = await requestNativeAuthCaptchaToken('native_phone_otp_resend');
      if (!captcha.ok) {
        setError(captcha.message);
        return;
      }
      const { data, error: otpError } = await supabase.auth.signInWithOtp({
        phone: phoneForOtp,
        ...(captcha.token ? { options: { captchaToken: captcha.token } } : {}),
      });
      logPhoneOtpDebug('signInWithOtp resend', phoneForOtp, {
        hasError: !!otpError,
        error: otpError ? authErrorDebugInfo(otpError) : null,
        hasData: data != null,
      });
      if (otpError) throw otpError;
      const nextAttempts = resendAttempts + 1;
      setResendAttempts(nextAttempts);
      setResendRemaining(nextAuthOtpCooldownSeconds(nextAttempts));
    } catch (e: unknown) {
      const nextAttempts = resendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(nextAttempts, e);
      setResendAttempts(nextAttempts);
      setResendRemaining(cooldown);
      const conflict = mapAuthConflictError(e, 'phone_otp_resend');
      if (conflict.message) setError(conflict.message);
      else setError(mapPhoneOtpSendError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    trackEvent('auth_method_selected', { method: 'email', platform: 'native' });
    trackEvent('auth_email_signin', { platform: 'native' });
    try {
      const captcha = await requestNativeAuthCaptchaToken('native_email_signin');
      if (!captcha.ok) {
        setError(captcha.message);
        return;
      }
      const { error: e } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        ...(captcha.token ? { options: { captchaToken: captcha.token } } : {}),
      });
      if (e) throw e;
      setView('success');
    } catch (e: unknown) {
      const conflict = mapAuthConflictError(e, 'email_sign_in');
      if (conflict.message) setError(conflict.message);
      else setError(errorMessage(e, 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email.trim() || !password || !name.trim()) return;
    const passwordPolicy = validatePasswordPolicy(password);
    if (!passwordPolicy.valid) {
      setError(passwordPolicy.message ?? passwordPolicyMessage());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const signupEmail = email.trim();
      const captcha = await requestNativeAuthCaptchaToken('native_email_signup');
      if (!captcha.ok) {
        setError(captcha.message);
        return;
      }
      const { data, error: e } = await supabase.auth.signUp({
        email: signupEmail,
        password,
        options: {
          emailRedirectTo: getNativeEmailSignUpRedirectUrl(),
          data: { name: name.trim() },
          ...(captcha.token ? { captchaToken: captcha.token } : {}),
        },
      });
      if (e) throw e;
      if (!data.user) {
        throw new Error('We could not create your account. Please try again.');
      }
      trackEvent('auth_email_signup', { platform: 'native' });
      setPassword('');
      if (data.session?.user) {
        setView('success');
        return;
      }
      setPendingConfirmationEmail(signupEmail);
      setEmailResendAttempts(0);
      setEmailResendCooldown(60);
      setEmailResendMessage(null);
      setView('email_signup_pending');
    } catch (e: unknown) {
      const conflict = mapAuthConflictError(e, 'email_sign_up');
      if (conflict.message) {
        setError(conflict.message);
        if (conflict.suggestEmailSignIn) setView('email_signin');
      } else {
        setError(errorMessage(e, 'Sign up failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail || emailResendCooldown > 0) return;
    setEmailResendMessage(null);
    setLoading(true);
    try {
      const captcha = await requestNativeAuthCaptchaToken('native_email_signup_resend');
      if (!captcha.ok) {
        setEmailResendMessage(captcha.message);
        return;
      }
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingConfirmationEmail,
        options: {
          emailRedirectTo: getNativeEmailSignUpRedirectUrl(),
          ...(captcha.token ? { captchaToken: captcha.token } : {}),
        },
      });
      if (error) throw error;
      const attempt = emailResendAttempts + 1;
      setEmailResendAttempts(attempt);
      setEmailResendCooldown(nextAuthOtpCooldownSeconds(attempt));
      setEmailResendMessage('Email sent again. Check your inbox.');
    } catch (e: unknown) {
      const attempt = emailResendAttempts + 1;
      const cooldown = nextAuthOtpCooldownSeconds(attempt, e);
      setEmailResendAttempts(attempt);
      setEmailResendCooldown(cooldown);
      setEmailResendMessage(`Could not resend. Try again in ${formatAuthCooldown(cooldown)}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    trackEvent('auth_method_selected', { method: 'google', platform: 'native' });
    trackEvent('auth_social_started', { provider: 'google' });
    try {
      const { cancelled, error: oauthErr } = await startNativeGoogleOAuth(supabase);
      if (cancelled) return;
      if (oauthErr) {
        const conflict = mapAuthConflictError(oauthErr, 'google');
        setError(conflict.message || safeAuthErrorMessage(oauthErr, 'Google sign-in failed.'));
        return;
      }
      trackEvent('auth_social_completed', { provider: 'google', platform: 'native' });
      setView('success');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setLoading(true);
    trackEvent('auth_method_selected', { method: 'apple', platform: 'native' });
    trackEvent('auth_social_started', { provider: 'apple' });
    try {
      if (Platform.OS !== 'ios') {
        setError('Apple Sign In is only available on iOS');
        return;
      }

      let available = appleSignInAvailable === true;
      if (!available) {
        try {
          available = await AppleAuthentication.isAvailableAsync();
          addAppleAuthDiagnostic('Availability checked', { source: 'apple_tap', available });
          setAppleSignInAvailable(available);
        } catch {
          addAppleAuthDiagnostic('Availability check failed', { source: 'apple_tap' }, 'warning');
          available = false;
        }
      }

      if (!available) {
        addAppleAuthDiagnostic('Tap blocked because availability is false', { source: 'apple_tap' }, 'warning');
        setError('Apple Sign In is not available on this iOS build.');
        return;
      }

      const captcha = await runAppleAuthStage(
        'captcha',
        () => requestNativeAuthCaptchaToken('native_apple_signin', {
          timeoutMs: NATIVE_APPLE_AUTH_CAPTCHA_TIMEOUT_MS,
        }),
        {
          startedData: { timeoutMs: NATIVE_APPLE_AUTH_CAPTCHA_TIMEOUT_MS },
          completedData: (result) => ({
            ok: result.ok,
            captchaTokenPresent: result.ok ? Boolean(result.token) : false,
            captchaTokenLength: result.ok && result.token ? result.token.length : null,
          }),
        },
      );
      if (!captcha.ok) {
        addAppleAuthStageDiagnostic('captcha', 'failed', {
          reason: 'not_ok',
          messagePrefix: captcha.message.slice(0, 120),
        }, 'warning');
        setError(captcha.message);
        return;
      }

      const { rawNonce, hashedNonce } = await runAppleAuthStage(
        'nonce',
        () => createAppleAuthNoncePair(),
        {
          completedData: (noncePair) => ({
            rawNoncePresent: Boolean(noncePair.rawNonce),
            rawNonceLength: noncePair.rawNonce.length,
            hashedNoncePresent: Boolean(noncePair.hashedNonce),
            hashedNonceLength: noncePair.hashedNonce.length,
          }),
        },
      );
      logAppleNonceDebug('Prepared native Apple sign-in nonce pair', { rawNonce, hashedNonce });

      const credential = await runAppleAuthStage(
        'apple_authorization',
        async () => {
          const appleCredential = await AppleAuthentication.signInAsync({
            requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
            nonce: hashedNonce,
          });
          buildAppleSupabaseIdTokenCredentials({
            credential: appleCredential,
            rawNonce,
            captchaToken: captcha.token,
          });
          return appleCredential;
        },
        {
          completedData: (appleCredential) => {
            const summary = summarizeAppleCredentialForDebug(appleCredential);
            return {
              identityTokenPresent: summary.identityToken.exists,
              identityTokenLength: summary.identityToken.length,
              authorizationCodePresent: summary.authorizationCode.exists,
              authorizationCodeLength: summary.authorizationCode.length,
              fullNamePresent: summary.fullName.exists,
              emailPresent: summary.email.exists,
            };
          },
        },
      );

      logAppleNonceDebug('Submitting native Apple sign-in nonce pair to Supabase', { rawNonce, hashedNonce });
      const appleIdTokenCredentials = buildAppleSupabaseIdTokenCredentials({
        credential,
        rawNonce,
        captchaToken: captcha.token,
      });
      const { data, error: e } = await runAppleAuthStage(
        'supabase_exchange',
        () => supabase.auth.signInWithIdToken(appleIdTokenCredentials),
        {
          timeoutMs: NATIVE_APPLE_AUTH_SUPABASE_TIMEOUT_MS,
          startedData: {
            authorizationCodePresent: Boolean(appleIdTokenCredentials.access_token),
            captchaTokenPresent: Boolean(captcha.token),
          },
          completedData: (result) => ({
            hasError: Boolean(result.error),
            hasUser: Boolean(result.data.user),
            hasSession: Boolean(result.data.session),
          }),
        },
      );
      if (e) throw e;
      if (!data.session) {
        throw new Error('Apple sign-in did not return a session. Please try again.');
      }

      await runAppleAuthStage(
        'cache_prime',
        async () => {
          primeCachedSession(data.session);
          return data.session;
        },
        {
          completedData: (session) => ({
            hasSession: Boolean(session),
            hasUser: Boolean(session.user),
          }),
        },
      );

      const nameMetadataPatch = buildAppleNameMetadataPatch({
        existingMetadata: data.user?.user_metadata,
        fullName: credential.fullName,
      });
      if (nameMetadataPatch) {
        await runAppleAuthStage(
          'metadata_update',
          async () => {
            const updateResult = await supabase.auth.updateUser({ data: nameMetadataPatch });
            if (updateResult.error) throw updateResult.error;
            return updateResult;
          },
          {
            timeoutMs: NATIVE_APPLE_AUTH_METADATA_TIMEOUT_MS,
            completedData: (result) => ({
              hasUser: Boolean(result.data.user),
            }),
          },
        ).catch((updateError) => {
          console.warn('[auth] failed to persist Apple full name metadata', {
            message: errorMessage(updateError, 'metadata_update_failed'),
          });
        });
      } else {
        addAppleAuthStageDiagnostic('metadata_update', 'skipped', { reason: 'no_name_metadata' });
      }
      trackEvent('auth_social_completed', { provider: 'apple', platform: 'native' });
      setView('success');
    } catch (e: unknown) {
      const diagnostics = appleAuthErrorDiagnostics(e);
      if (isAppleAuthCancelled(e)) {
        addAppleAuthDiagnostic('Authorization cancelled', diagnostics, 'info');
        trackEvent('auth_social_cancelled', { provider: 'apple', platform: 'native' });
        return;
      }
      addAppleAuthDiagnostic('Authorization failed', diagnostics, 'warning');
      const conflict = mapAuthConflictError(e, 'apple');
      if (conflict.message) {
        setError(conflict.message);
      } else {
        setError(errorMessage(e, 'Apple Sign In failed. Try another method.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const renderAppleAuthCta = () => {
    if (Platform.OS !== 'ios') return null;
    return <VibelyButton label="Continue with Apple" onPress={handleAppleSignIn} variant="secondary" disabled={loading} />;
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandWrap}>
          <View style={[styles.logo, { backgroundColor: theme.tint }]}><Ionicons name="sparkles" size={24} color="#fff" /></View>
          <Text style={[styles.brandTitle, { color: theme.text }]}>Find your vibe</Text>
          <Text style={[styles.brandSub, { color: theme.textSecondary }]}>Events. Video dates. Real connections.</Text>
        </View>

        {view === 'welcome' ? (
          <View style={styles.block}>
            <Pressable
              onPress={() => setShowCountryModal(true)}
              style={[styles.codeSelector, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            >
              <Text style={{ color: theme.text }}>
                {selectedCountry.flag} {selectedCountry.code}
              </Text>
              <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
            </Pressable>
            <TextInput
              value={phoneInput}
              onChangeText={(v) => setPhoneInput(v)}
              keyboardType="phone-pad"
              placeholder="Mobile number (no leading 0)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            />
            <VibelyButton
              label={phoneSendCooldownRemaining > 0 ? `Try again in ${formatAuthCooldown(phoneSendCooldownRemaining)}` : 'Continue'}
              onPress={handlePhoneSubmit}
              variant="gradient"
              disabled={!phoneValid || loading || phoneSendCooldownRemaining > 0}
            />
            <Text style={[styles.or, { color: theme.textSecondary }]}>or</Text>
            <VibelyButton label="Continue with Google" onPress={handleGoogleSignIn} variant="secondary" disabled={loading} />
            {renderAppleAuthCta()}
            <Pressable onPress={() => { setView('email_signin'); setError(null); }}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Use email instead</Text></Pressable>
            <Pressable onPress={() => router.push('/(auth)/reset-password')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Forgot password?</Text></Pressable>
            <Text style={[styles.legalNotice, { color: theme.textSecondary }]}>
              By continuing, you agree to our{' '}
              <Text
                accessibilityRole="link"
                style={[styles.legalLink, { color: theme.tint }]}
                onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_ORIGIN}/terms`).catch(() => {})}
              >
                Terms
              </Text>
              {' and '}
              <Text
                accessibilityRole="link"
                style={[styles.legalLink, { color: theme.tint }]}
                onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_ORIGIN}/privacy`).catch(() => {})}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        ) : null}

        {view === 'otp' ? (
          <View style={styles.block}>
            <Pressable onPress={() => setView('welcome')}><Text style={{ color: theme.textSecondary }}>← Back</Text></Pressable>
            <Text style={[styles.h2, { color: theme.text }]}>Enter your code</Text>
            <Text style={{ color: theme.textSecondary }}>We sent a 6-digit code to {phoneForOtp}</Text>
            <View style={styles.otpRow}>
              {otpDigits.map((d, i) => (
                <TextInput key={i} ref={(r) => { otpRefs.current[i] = r; }} value={d} onChangeText={(v) => handleOtpDigit(i, v)} keyboardType="number-pad" maxLength={1} style={[styles.otp, { borderColor: error ? theme.danger : theme.border, color: theme.text }]} />
              ))}
            </View>
            {resendRemaining > 0 ? <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Resend in {Math.floor(resendRemaining / 60)}:{String(resendRemaining % 60).padStart(2, '0')}</Text> : <Pressable onPress={resendOtp}><Text style={{ color: theme.tint, textAlign: 'center' }}>Didn't get it? Resend code</Text></Pressable>}
            <Pressable onPress={() => setView('welcome')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Wrong number?</Text></Pressable>
          </View>
        ) : null}

        {view === 'email_signin' ? (
          <View style={styles.block}>
            <Pressable onPress={() => setView('welcome')}><Text style={{ color: theme.textSecondary }}>← Back</Text></Pressable>
            <Text style={[styles.h2, { color: theme.text }]}>Sign in with email</Text>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <VibelyButton label="Sign in" onPress={handleEmailSignIn} variant="gradient" disabled={loading} />
            {renderAppleAuthCta()}
            <Pressable onPress={() => router.push('/(auth)/reset-password')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Forgot password?</Text></Pressable>
            <Pressable onPress={() => setView('email_signup')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Don't have an account? Create one</Text></Pressable>
          </View>
        ) : null}

        {view === 'email_signup' ? (
          <View style={styles.block}>
            <Pressable onPress={() => setView('welcome')}><Text style={{ color: theme.textSecondary }}>← Back</Text></Pressable>
            <Text style={[styles.h2, { color: theme.text }]}>Create your account</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <VibelyButton label="Create account" onPress={handleEmailSignUp} variant="gradient" disabled={loading} />
            {renderAppleAuthCta()}
            <Text style={[styles.legalNotice, { color: theme.textSecondary }]}>
              By creating an account, you agree to our{' '}
              <Text
                accessibilityRole="link"
                style={[styles.legalLink, { color: theme.tint }]}
                onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_ORIGIN}/terms`).catch(() => {})}
              >
                Terms
              </Text>
              {' and '}
              <Text
                accessibilityRole="link"
                style={[styles.legalLink, { color: theme.tint }]}
                onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_ORIGIN}/privacy`).catch(() => {})}
              >
                Privacy Policy
              </Text>
              .
            </Text>
            <Pressable onPress={() => setView('email_signin')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Already have an account? Sign in</Text></Pressable>
          </View>
        ) : null}

        {view === 'email_signup_pending' ? (
          <View style={styles.block}>
            <Pressable onPress={() => setView('email_signup')}><Text style={{ color: theme.textSecondary }}>← Back</Text></Pressable>
            <Text style={[styles.h2, { color: theme.text }]}>Check your email</Text>
            <Text style={{ color: theme.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              We sent a confirmation link to {pendingConfirmationEmail || email.trim() || 'your email address'}.
              Open it on this device to finish signing in.
            </Text>
            {emailResendMessage ? (
              <Text style={{ color: theme.textSecondary, textAlign: 'center', fontSize: 13 }}>{emailResendMessage}</Text>
            ) : null}
            {emailResendCooldown > 0 ? (
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Resend available in {emailResendCooldown}s</Text>
            ) : (
              <Pressable onPress={handleResendConfirmation}>
                <Text style={{ color: theme.tint, textAlign: 'center' }}>Resend confirmation email</Text>
              </Pressable>
            )}
            <VibelyButton label="Back to sign in" onPress={() => setView('email_signin')} variant="gradient" />
            <Pressable onPress={() => setView('email_signup')}>
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Use a different email</Text>
            </Pressable>
          </View>
        ) : null}

        {view === 'success' ? (
          <View style={styles.success}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={[styles.h2, { color: theme.text }]}>Welcome to Vibely!</Text>
            {profileBootstrapState === 'ensuring' ? (
              <>
                <ActivityIndicator color={theme.tint} style={{ marginTop: 12 }} />
                <Text style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 8 }}>
                  Finishing your account setup...
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        {profileBootstrapState === 'failed' ? (
          <View style={[styles.block, { borderColor: theme.border, borderWidth: 1 }]}> 
            <Text style={[styles.h2, { color: theme.text }]}>Account setup check required</Text>
            <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
              {profileBootstrapMessage || 'We could not verify your account setup right now. Retry setup check or sign out and sign in again.'}
            </Text>
            <VibelyButton label="Retry setup check" onPress={retryProfileSetup} variant="gradient" />
            <VibelyButton label="Sign out" onPress={signOutFromRecovery} variant="secondary" />
          </View>
        ) : null}

        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={theme.tint} style={{ marginTop: 12 }} /> : null}
      </ScrollView>

      <KeyboardAwareBottomSheetModal
        visible={showCountryModal}
        onRequestClose={() => setShowCountryModal(false)}
        animationType="slide"
        scrollable={false}
        showHandle
        sheetStyle={styles.modalSheet}
      >
        <View style={[styles.modalRoot, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select country code</Text>
            <Pressable onPress={() => setShowCountryModal(false)}>
              <Text style={{ color: theme.tint }}>Close</Text>
            </Pressable>
          </View>
          <TextInput
            value={countrySearchQuery}
            onChangeText={setCountrySearchQuery}
            placeholder="Search country or code"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <SectionList
            sections={countrySections}
            keyExtractor={(item) => `${item.code}-${item.name}`}
            style={styles.modalList}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setCountryCode(item.code);
                  setCountryName(item.name);
                  setShowCountryModal(false);
                }}
                style={[styles.countryItem, { borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text }}>{item.flag} {item.name}</Text>
                <Text style={{ color: theme.textSecondary }}>{item.code}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 16 }}>
                No countries found.
              </Text>
            }
          />
        </View>
      </KeyboardAwareBottomSheetModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 12 },
  brandWrap: { alignItems: 'center', marginBottom: 8 },
  logo: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  brandTitle: { fontSize: 34, fontWeight: '800' },
  brandSub: { marginTop: 6, fontSize: 14 },
  block: { gap: 10 },
  codeSelector: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: { borderWidth: 1, borderRadius: 14, minHeight: 48, paddingHorizontal: 12 },
  or: { textAlign: 'center', marginVertical: 4 },
  h2: { fontSize: 26, fontWeight: '700' },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  otp: { width: 44, height: 54, borderWidth: 1, borderRadius: 12, textAlign: 'center', fontSize: 22 },
  success: { alignItems: 'center', gap: 10, marginTop: 30 },
  emoji: { fontSize: 48 },
  error: { textAlign: 'center', fontSize: 13 },
  modalRoot: { flex: 1, minHeight: 420, gap: 12 },
  modalSheet: { minHeight: 420, paddingTop: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalList: { flex: 1 },
  sectionHeader: { marginTop: 14, marginBottom: 8, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  countryItem: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  legalNotice: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  legalLink: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
