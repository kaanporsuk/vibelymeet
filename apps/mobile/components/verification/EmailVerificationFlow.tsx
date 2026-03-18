/**
 * Native email verification: show email + send code → OTP → success. Uses email-verification Edge Function.
 * Reference: src/hooks/useEmailVerification.ts, supabase/functions/email-verification/index.ts
 */
import React, { useState, useEffect } from 'react';
import { View, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { supabase } from '@/lib/supabase';

type Step = 'send' | 'otp' | 'success';

type EmailVerificationFlowProps = {
  visible: boolean;
  email: string;
  onClose: () => void;
  onVerified: () => void;
};

export function EmailVerificationFlow({ visible, email, onClose, onVerified }: EmailVerificationFlowProps) {
  const theme = Colors[useColorScheme()];
  const [step, setStep] = useState<Step>('send');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep('send');
      setOtp(['', '', '', '', '', '']);
      setError(null);
      setMessage(null);
      setRemainingAttempts(null);
    }
  }, [visible]);

  const sendCode = async () => {
    if (!email?.trim()) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('email-verification/send', {
        body: { email: email.trim() },
      });
      if (invokeError) {
        setError('Failed to send code. Check your connection.');
        setSending(false);
        return;
      }
      if ((data as { error?: string })?.error) {
        setError((data as { error: string }).error);
        setSending(false);
        return;
      }
      setMessage(`Code sent to ${email.trim()}`);
      setStep('otp');
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async (code: string) => {
    if (code.length !== 6 || !email?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('email-verification/verify', {
        body: { email: email.trim(), code },
      });
      if (invokeError) {
        setError('Verification failed.');
        setLoading(false);
        return;
      }
      const d = data as { error?: string; remainingAttempts?: number };
      if (d?.error) {
        setError(d.error);
        if (d.remainingAttempts != null) setRemainingAttempts(d.remainingAttempts);
        setLoading(false);
        return;
      }
      setStep('success');
      const t = setTimeout(() => {
        onVerified();
        onClose();
      }, 1500);
      return () => clearTimeout(t);
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
    if (code.length === 6) verifyCode(code);
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
            {step === 'send' && 'Verify Email'}
            {step === 'otp' && 'Enter Code'}
            {step === 'success' && 'Verified!'}
          </VibelyText>

          {step === 'send' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="mail" size={32} color={theme.tint} />
              </View>
              <VibelyText variant="body" style={[styles.hint, { color: theme.textSecondary }]}>
                We'll send a 6-digit code to:
              </VibelyText>
              <VibelyText variant="body" style={[styles.emailDisplay, { color: theme.text }]}>{email || '—'}</VibelyText>
              {message ? <VibelyText variant="caption" style={[styles.msg, { color: theme.success }]}>{message}</VibelyText> : null}
              {error ? <VibelyText variant="caption" style={[styles.err, { color: theme.danger }]}>{error}</VibelyText> : null}
              <VibelyButton label={sending ? 'Sending…' : 'Send Verification Code'} onPress={sendCode} disabled={sending || !email?.trim()} loading={sending} style={styles.cta} />
            </>
          )}

          {step === 'otp' && (
            <>
              <VibelyText variant="body" style={[styles.hint, { color: theme.textSecondary }]}>
                Enter the code sent to {email}
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
              {remainingAttempts != null && remainingAttempts < 7 && (
                <VibelyText variant="caption" style={{ color: theme.textSecondary }}>{remainingAttempts} attempts remaining this hour</VibelyText>
              )}
              <VibelyButton label={loading ? 'Verifying…' : 'Verify'} onPress={() => verifyCode(otp.join(''))} disabled={loading || otp.some((c) => !c)} loading={loading} style={styles.cta} />
            </>
          )}

          {step === 'success' && (
            <View style={styles.successWrap}>
              <View style={[styles.successIcon, { backgroundColor: withAlpha(theme.success, 0.19) }]}>
                <Ionicons name="checkmark-circle" size={48} color={theme.success} />
              </View>
              <VibelyText variant="titleSM" style={{ color: theme.text }}>Email verified!</VibelyText>
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
  hint: { textAlign: 'center', marginBottom: spacing.sm },
  emailDisplay: { textAlign: 'center', marginBottom: spacing.md, fontWeight: '600' },
  msg: { textAlign: 'center', marginBottom: spacing.sm },
  err: { marginBottom: spacing.sm },
  cta: { marginTop: spacing.md },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.md },
  otpBox: { width: 44, height: 52, borderWidth: 2, borderRadius: radius.lg, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  successWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
});
