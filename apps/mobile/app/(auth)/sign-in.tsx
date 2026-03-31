import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
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

type AuthView = 'welcome' | 'otp' | 'email_signin' | 'email_signup' | 'success';

const COUNTRY_CODES = ['+31', '+49', '+33', '+44', '+34', '+39', '+48', '+90', '+46', '+351', '+1'];

export default function SignInScreen() {
  const theme = Colors[useColorScheme()];
  const { session } = useAuth();

  const [view, setView] = useState<AuthView>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState('+31');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneForOtp, setPhoneForOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const phoneDigits = useMemo(() => phoneInput.replace(/\D/g, ''), [phoneInput]);
  const phoneValid = phoneDigits.length >= 7;

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
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', session.user.id).maybeSingle();
      if (existing) return;
      const metadata = session.user.user_metadata ?? {};
      const referrerId = null;
      await supabase.from('profiles').insert({
        id: session.user.id,
        name: metadata.full_name || metadata.name || '',
        referred_by: referrerId,
      });
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
    if (!phoneValid) return;
    setLoading(true);
    setError(null);
    trackEvent('auth_method_selected', { method: 'phone' });
    trackEvent('auth_phone_submitted', {});
    try {
      const phone = `${countryCode}${phoneDigits}`;
      const { error: e } = await supabase.auth.signInWithOtp({ phone });
      if (e) throw e;
      setPhoneForOtp(phone);
      setOtpDigits(['', '', '', '', '', '']);
      setView('otp');
      setResendAttempts(0);
      setResendRemaining(60);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Try again.');
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
      trackEvent('auth_otp_verified', {});
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
      const { error: e } = await supabase.auth.signInWithOtp({ phone: phoneForOtp });
      if (e) throw e;
      const nextAttempts = resendAttempts + 1;
      setResendAttempts(nextAttempts);
      setResendRemaining(nextAttempts === 1 ? 60 : nextAttempts === 2 ? 180 : 900);
    } catch {
      setError('Could not resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    trackEvent('auth_method_selected', { method: 'email' });
    trackEvent('auth_email_signin', {});
    try {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) throw e;
      setView('success');
    } catch (e: any) {
      setError(e?.message ?? 'Sign in failed');
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
        await supabase.from('profiles').insert({ id: data.user.id, name: name.trim(), gender: 'prefer_not_to_say' });
      }
      trackEvent('auth_email_signup', {});
      setView('email_signin');
    } catch (e: any) {
      setError(e?.message ?? 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    trackEvent('auth_method_selected', { method: 'google' });
    trackEvent('auth_social_started', { provider: 'google' });
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'com.vibelymeet.vibely://auth/callback' },
    });
    if (e) setError(e.message);
  };

  const handleAppleSignIn = async () => {
    setError(null);
    trackEvent('auth_method_selected', { method: 'apple' });
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
            <View style={styles.row}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codes}>
                {COUNTRY_CODES.map((code) => (
                  <Pressable key={code} onPress={() => setCountryCode(code)} style={[styles.codeChip, { borderColor: countryCode === code ? theme.tint : theme.border }]}>
                    <Text style={{ color: countryCode === code ? theme.tint : theme.textSecondary }}>{code}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <TextInput value={phoneInput} onChangeText={(v) => setPhoneInput(v)} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <VibelyButton label="Continue" onPress={handlePhoneSubmit} variant="gradient" disabled={!phoneValid || loading} />
            <Text style={[styles.or, { color: theme.textSecondary }]}>or</Text>
            <VibelyButton label="Continue with Google" onPress={handleGoogleSignIn} variant="secondary" />
            <VibelyButton label="Continue with Apple" onPress={handleAppleSignIn} variant="secondary" />
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
  row: { flexDirection: 'row' },
  codes: { gap: 6 },
  codeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  input: { borderWidth: 1, borderRadius: 14, minHeight: 48, paddingHorizontal: 12 },
  or: { textAlign: 'center', marginVertical: 4 },
  h2: { fontSize: 26, fontWeight: '700' },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  otp: { width: 44, height: 54, borderWidth: 1, borderRadius: 12, textAlign: 'center', fontSize: 22 },
  success: { alignItems: 'center', gap: 10, marginTop: 30 },
  emoji: { fontSize: 48 },
  error: { textAlign: 'center', fontSize: 13 },
});
