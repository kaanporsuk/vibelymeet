/**
 * Native phone verification: phone input → OTP → success. Uses phone-verify Edge Function (send_otp, verify_otp).
 * Reference: src/components/PhoneVerification.tsx, supabase/functions/phone-verify/index.ts
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Modal, Pressable, TextInput, StyleSheet, Animated, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { supabase } from '@/lib/supabase';

const COUNTRY_CODES = [
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+90', label: '🇹🇷 +90' },
  { code: '+48', label: '🇵🇱 +48' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+34', label: '🇪🇸 +34' },
];

type Step = 'phone' | 'otp' | 'success';

type PhoneVerificationFlowProps = {
  visible: boolean;
  onClose: () => void;
  onVerified: () => void;
  /** E.164 e.g. +905551234567 — prefills country + local digits when opening */
  initialPhoneE164?: string | null;
};

export function PhoneVerificationFlow({ visible, onClose, onVerified, initialPhoneE164 }: PhoneVerificationFlowProps) {
  const theme = Colors[useColorScheme()];
  const [step, setStep] = useState<Step>('phone');
  const [countryCode, setCountryCode] = useState('+90');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const successScale = useRef(new Animated.Value(0)).current;

  const cleaned = phoneNumber.replace(/\D/g, '').replace(/^0+/, '');
  const fullNumber = `${countryCode}${cleaned}`;
  const maskedPhone = fullNumber.replace(/(\+\d{1,3})\d+(\d{2})$/, '$1 •••• ••$2');

  useEffect(() => {
    if (!visible) {
      setStep('phone');
      setPhoneNumber('');
      setOtp(['', '', '', '', '', '']);
      setError(null);
      setFailedAttempts(0);
      return;
    }
    if (initialPhoneE164) {
      const raw = initialPhoneE164.replace(/\s/g, '');
      const match = raw.match(/^(\+\d{1,3})(.*)$/);
      if (match) {
        const cc = match[1];
        const rest = match[2].replace(/\D/g, '');
        const known = COUNTRY_CODES.some((c) => c.code === cc);
        if (known) setCountryCode(cc);
        setPhoneNumber(rest);
      }
    } else {
      setPhoneNumber('');
      setCountryCode('+90');
    }
  }, [visible, initialPhoneE164]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 'success') {
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, tension: 100, friction: 8 }).start();
      const t = setTimeout(() => {
        onVerified();
        onClose();
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [step, onVerified, onClose, successScale]);

  const sendOtp = async () => {
    if (cleaned.length < 4 || fullNumber.length < 10 || fullNumber.length > 16) {
      setError('Enter a valid phone number (no leading zero).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'send_otp', phoneNumber: fullNumber },
      });
      if (invokeError) {
        setError('Could not reach server. Check your connection.');
        setLoading(false);
        return;
      }
      if (!data?.success) {
        const msg = data?.error ?? 'Failed to send code.';
        if (data?.errorType === 'rate_limited') setError('Too many attempts. Try again in an hour.');
        else if (data?.errorType === 'phone_already_claimed') setError('This phone number is already associated with another account.');
        else setError(msg);
        setLoading(false);
        return;
      }
      setStep('otp');
      setResendCooldown(60);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (code: string) => {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'verify_otp', phoneNumber: fullNumber, code },
      });
      if (invokeError) {
        setError('Could not reach server.');
        setLoading(false);
        return;
      }
      if (!data?.success) {
        const next = failedAttempts + 1;
        setFailedAttempts(next);
        if (data?.errorType === 'phone_already_claimed') {
          setError('This phone number is already associated with another account.');
        } else if (next >= 3) {
          setError('Too many attempts. Request a new code.');
          setStep('phone');
          setOtp(['', '', '', '', '', '']);
          setFailedAttempts(0);
        } else {
          setError(data?.error ?? 'Wrong code.');
        }
        setLoading(false);
        return;
      }
      setStep('success');
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    setError(null);
    const code = next.join('');
    if (code.length === 6) verifyOtp(code);
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setOtp(['', '', '', '', '', '']);
    setError(null);
    sendOtp();
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
            {step === 'phone' && 'Verify Phone'}
            {step === 'otp' && 'Enter Code'}
            {step === 'success' && 'Verified!'}
          </VibelyText>

          {step === 'phone' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="call" size={32} color={theme.tint} />
              </View>
              <VibelyText variant="body" style={[styles.hint, { color: theme.textSecondary }]}>
                We'll send a 6-digit code via SMS. Enter your number without leading zero.
              </VibelyText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryScroll} contentContainerStyle={styles.countryScrollContent}>
                {COUNTRY_CODES.map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => setCountryCode(c.code)}
                    style={[styles.countryChip, { borderColor: countryCode === c.code ? theme.tint : theme.border, backgroundColor: countryCode === c.code ? theme.tintSoft : theme.surfaceSubtle }]}
                  >
                    <VibelyText variant="caption" style={{ color: theme.text }}>{c.label}</VibelyText>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={[styles.row, { borderWidth: 1, borderRadius: radius.lg, borderColor: theme.border }]}>
                <View style={[styles.prefix, { borderRightColor: theme.border }]}>
                  <VibelyText variant="body" style={{ color: theme.text }}>{countryCode}</VibelyText>
                </View>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Phone number"
                  placeholderTextColor={theme.mutedForeground}
                  value={phoneNumber}
                  onChangeText={(t) => { setPhoneNumber(t); setError(null); }}
                  keyboardType="phone-pad"
                />
              </View>
              {error ? <VibelyText variant="caption" style={[styles.err, { color: theme.danger }]}>{error}</VibelyText> : null}
              <VibelyButton label={loading ? 'Sending…' : 'Send Code'} onPress={sendOtp} disabled={loading || cleaned.length < 4} loading={loading} style={styles.cta} />
            </>
          )}

          {step === 'otp' && (
            <>
              <Pressable onPress={() => { setStep('phone'); setError(null); }} style={styles.backRow}>
                <Ionicons name="arrow-back" size={20} color={theme.textSecondary} />
                <VibelyText variant="body" style={{ color: theme.textSecondary }}>Back</VibelyText>
              </Pressable>
              <VibelyText variant="body" style={[styles.hint, { color: theme.textSecondary }]}>
                Code sent to {maskedPhone}
              </VibelyText>
              <View style={styles.otpRow}>
                {otp.map((d, i) => (
                  <TextInput
                    key={i}
                    style={[styles.otpBox, { borderColor: theme.border, color: theme.text }]}
                    value={d}
                    onChangeText={(v) => handleOtpChange(i, v)}
                    keyboardType="number-pad"
                    maxLength={1}
                  />
                ))}
              </View>
              {error ? <VibelyText variant="caption" style={[styles.err, { color: theme.danger }]}>{error}</VibelyText> : null}
              {resendCooldown > 0 ? (
                <VibelyText variant="caption" style={{ color: theme.textSecondary }}>Resend code in {resendCooldown}s</VibelyText>
              ) : (
                <Pressable onPress={handleResend} disabled={loading}>
                  <VibelyText variant="body" style={{ color: theme.tint }}>Resend code</VibelyText>
                </Pressable>
              )}
            </>
          )}

          {step === 'success' && (
            <View style={styles.successWrap}>
              <Animated.View style={[styles.successIcon, { backgroundColor: withAlpha(theme.success, 0.19) }, { transform: [{ scale: successScale }] }]}>
                <Ionicons name="checkmark-circle" size={48} color={theme.success} />
              </Animated.View>
              <VibelyText variant="titleSM" style={{ color: theme.text }}>Your phone is verified</VibelyText>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  handle: { width: 100, height: 8, borderRadius: 999, alignSelf: 'center', marginTop: 16, marginBottom: 12 },
  title: { marginBottom: spacing.md, textAlign: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: 32, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  hint: { textAlign: 'center', marginBottom: spacing.md },
  countryScroll: { marginBottom: spacing.sm, maxHeight: 44 },
  countryScrollContent: { flexDirection: 'row', gap: spacing.xs, paddingVertical: 4 },
  countryChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  prefix: { paddingVertical: 12, paddingHorizontal: spacing.md, borderRightWidth: 1 },
  input: { flex: 1, paddingVertical: 12, paddingHorizontal: spacing.md, fontSize: 16 },
  err: { marginBottom: spacing.sm },
  cta: { marginTop: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.md },
  otpBox: { width: 44, height: 52, borderWidth: 2, borderRadius: radius.lg, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  successWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
});
