import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { startNativeGoogleOAuth } from '@/lib/nativeGoogleOAuth';
import { ensureBootstrapProfileExists } from '@/lib/profileBootstrap';
import { isValidSignInPhone } from '@/lib/phoneSignInNormalize';

/** Shown when Supabase reports an existing identity / linked provider (not necessarily email). */
const ACCOUNT_CONFLICT_HINT =
  'This account may already exist with another sign-in method. Try the method you used before.';

function mapPhoneOtpSendError(e: { message?: string; status?: number; code?: string }): string {
  const msg = String(e?.message ?? '');
  const lower = msg.toLowerCase();
  if (/phone.*not.*enabled|sms.*not|provider|not supported/i.test(msg)) {
    return 'Phone sign-in isn’t available on this app build. Try email or another method, or contact support.';
  }
  if (/invalid.*phone|malformed|format|e\.164/i.test(msg)) {
    return 'That number doesn’t look valid for the selected country. Use digits only and skip the leading 0.';
  }
  if (/rate|too many|flood|429/i.test(lower) || e?.status === 429) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if ((/otp|sms|send|text/i.test(lower) && /fail|error|unable/i.test(lower)) || /confirmation/i.test(lower)) {
    return 'We couldn’t send a code to this number. Check the number and your connection, then try again.';
  }
  return msg || 'Couldn’t send the code. Try again.';
}

/** Dev-only: never log full numbers; keep enough to verify country + length. */
function logPhoneOtpDebug(label: string, e164: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  const safe =
    e164.length <= 8 ? `${e164.slice(0, 3)}…` : `${e164.slice(0, 4)}…${e164.slice(-2)} (${e164.replace(/\D/g, '').length} digits)`;
  console.warn(`[sign-in] ${label}`, { normalizedPhone: safe, ...payload });
}

type AuthView = 'welcome' | 'otp' | 'email_signin' | 'email_signup' | 'success';

type Country = { name: string; code: string; flag: string; suggested?: boolean };

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
  const { session } = useAuth();

  const [view, setView] = useState<AuthView>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState('+48');
  const [countryName, setCountryName] = useState('Poland');
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneForOtp, setPhoneForOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

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
    const ensureProfileExists = async () => {
      if (!session?.user?.id) return;
      const result = await ensureBootstrapProfileExists(session.user, 'sign_in_screen_effect');
      if (!result.ok) {
        console.warn('[sign-in] bootstrap profile ensure failed', {
          userId: session.user.id,
          failure: result.reason,
        });
      }
    };
    void ensureProfileExists();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const t = setTimeout(() => {
      router.replace('/');
    }, view === 'success' ? 1200 : 0);
    return () => clearTimeout(t);
  }, [session?.user?.id, view]);

  const handlePhoneSubmit = async () => {
    const { e164, valid } = isValidSignInPhone(countryCode, phoneInput);
    if (!valid) {
      setError('Enter a valid phone number for this country (digits only, no leading 0).');
      return;
    }
    setLoading(true);
    setError(null);
    trackEvent('auth_method_selected', { method: 'phone', platform: 'native' });
    trackEvent('auth_phone_submitted', { platform: 'native' });
    try {
      const { data, error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 });
      logPhoneOtpDebug('signInWithOtp response', e164, {
        hasError: !!otpError,
        errorMessage: otpError?.message ?? null,
        errorCode: (otpError as { code?: string } | null)?.code ?? null,
        errorStatus: (otpError as { status?: number } | null)?.status ?? null,
        hasData: data != null,
        dataUser: !!data?.user,
        dataSession: !!data?.session,
      });
      if (otpError) throw otpError;
      setPhoneForOtp(e164);
      setOtpDigits(['', '', '', '', '', '']);
      setView('otp');
      setResendAttempts(0);
      setResendRemaining(60);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (/already|exists|linked|identity/i.test(msg)) {
        setError(ACCOUNT_CONFLICT_HINT);
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
      const { data, error: otpError } = await supabase.auth.signInWithOtp({ phone: phoneForOtp });
      logPhoneOtpDebug('signInWithOtp resend', phoneForOtp, {
        hasError: !!otpError,
        errorMessage: otpError?.message ?? null,
        errorCode: (otpError as { code?: string } | null)?.code ?? null,
        hasData: data != null,
      });
      if (otpError) throw otpError;
      const nextAttempts = resendAttempts + 1;
      setResendAttempts(nextAttempts);
      setResendRemaining(nextAttempts === 1 ? 60 : nextAttempts === 2 ? 180 : 900);
    } catch (e: any) {
      setError(mapPhoneOtpSendError(e));
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
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) throw e;
      setView('success');
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (/already|exists|identity|provider|linked/i.test(msg)) {
        setError(ACCOUNT_CONFLICT_HINT);
      } else {
        setError(msg || 'Sign in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email.trim() || !password || !name.trim()) return;
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
      if (e) throw e;
      if (data.user) {
        const ensured = await ensureBootstrapProfileExists(data.user, 'email_signup');
        if (!ensured.ok) {
          setError('Account created, but profile bootstrap needs a retry. Please sign in again.');
          return;
        }
      }
      trackEvent('auth_email_signup', { platform: 'native' });
      setView('email_signin');
    } catch (e: any) {
      setError(e?.message ?? 'Sign up failed');
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
        const msg = String(oauthErr.message ?? '');
        if (/already|exists|identity|provider|linked/i.test(msg)) {
          setError(ACCOUNT_CONFLICT_HINT);
        } else {
          setError(msg || 'Google sign-in failed.');
        }
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
    trackEvent('auth_method_selected', { method: 'apple', platform: 'native' });
    trackEvent('auth_social_started', { provider: 'apple' });
    try {
      if (Platform.OS !== 'ios') {
        setError('Apple Sign In is only available on iOS');
        return;
      }
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) throw new Error('Missing Apple token');
      const { error: e } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
      if (e) throw e;
      trackEvent('auth_social_completed', { provider: 'apple', platform: 'native' });
      setView('success');
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') setError('Apple Sign In failed. Try another method.');
    }
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
            <VibelyButton label="Continue" onPress={handlePhoneSubmit} variant="gradient" disabled={!phoneValid || loading} />
            <Text style={[styles.or, { color: theme.textSecondary }]}>or</Text>
            <VibelyButton label="Continue with Google" onPress={handleGoogleSignIn} variant="secondary" disabled={loading} />
            <VibelyButton label="Continue with Apple" onPress={handleAppleSignIn} variant="secondary" disabled={loading} />
            <Pressable onPress={() => { setView('email_signin'); setError(null); }}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Use email instead</Text></Pressable>
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
            <Pressable onPress={() => setView('email_signin')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Already have an account? Sign in</Text></Pressable>
          </View>
        ) : null}

        {view === 'success' ? (
          <View style={styles.success}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={[styles.h2, { color: theme.text }]}>Welcome to Vibely!</Text>
          </View>
        ) : null}

        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={theme.tint} style={{ marginTop: 12 }} /> : null}
      </ScrollView>

      <Modal visible={showCountryModal} animationType="slide" onRequestClose={() => setShowCountryModal(false)}>
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
      </Modal>
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
  modalRoot: { flex: 1, padding: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
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
});
