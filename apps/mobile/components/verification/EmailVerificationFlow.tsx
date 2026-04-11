/**
 * Native email verification: show email + send code → OTP → success. Uses email-verification Edge Function.
 * Reference: src/hooks/useEmailVerification.ts, supabase/functions/email-verification/index.ts
 */
import React, { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { resolveSupabaseFunctionErrorMessage } from '../../../../src/lib/supabaseFunctionInvokeErrors';

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
        const message = await resolveSupabaseFunctionErrorMessage(
          invokeError,
          data,
          "Couldn't reach the server. Check your connection and try again.",
        );
        setError(message);
        setSending(false);
        return;
      }
      if ((data as { error?: string })?.error) {
        setError((data as { error: string }).error);
        setSending(false);
        return;
      }
      setMessage('Verification code sent to your current account email.');
      setStep('otp');
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : "Couldn't reach the server. Check your connection and try again.";
      setError(message);
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
        const message = await resolveSupabaseFunctionErrorMessage(
          invokeError,
          data,
          "Couldn't reach the server. Check your connection and try again.",
        );
        setError(message);
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
      setTimeout(() => {
        onVerified();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : "Couldn't reach the server. Check your connection and try again.";
      setError(message);
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

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      backdropColor="rgba(0,0,0,0.8)"
      showHandle
      handleStyle={{ width: 100, height: 8, borderRadius: 999, marginTop: 16, marginBottom: 12 }}
    >
      <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
        {step === 'send' && 'Verify Current Email'}
        {step === 'otp' && 'Enter Code'}
        {step === 'success' && 'Verified!'}
      </VibelyText>

      {step === 'send' && (
        <>
          <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
            <Ionicons name="mail" size={32} color={theme.tint} />
          </View>
          <VibelyText variant="body" style={[styles.hint, { color: theme.textSecondary }]}>
            We'll send a 6-digit code to the current email on your account:
          </VibelyText>
          <VibelyText variant="body" style={[styles.emailDisplay, { color: theme.text }]}>{email || '—'}</VibelyText>
          <VibelyText variant="caption" style={[styles.msg, { color: theme.textSecondary }]}>
            We’ll email a one-time code to this address. If you recently changed your account email, finish that change first.
          </VibelyText>
          {message ? <VibelyText variant="caption" style={[styles.msg, { color: theme.success }]}>{message}</VibelyText> : null}
          {error ? <VibelyText variant="caption" style={[styles.err, { color: theme.danger }]}>{error}</VibelyText> : null}
          <VibelyButton label={sending ? 'Sending...' : 'Send Code'} onPress={sendCode} disabled={sending || !email?.trim()} loading={sending} style={styles.cta} />
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
          <VibelyButton label={loading ? 'Verifying...' : 'Verify'} onPress={() => verifyCode(otp.join(''))} disabled={loading || otp.some((c) => !c)} loading={loading} style={styles.cta} />
        </>
      )}

      {step === 'success' && (
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: withAlpha(theme.success, 0.19) }]}>
            <Ionicons name="checkmark-circle" size={48} color={theme.success} />
          </View>
          <VibelyText variant="titleSM" style={{ color: theme.text }}>Email badge added</VibelyText>
          <VibelyText variant="bodySecondary" style={{ color: theme.textSecondary, textAlign: 'center' }}>
            Your current account email is now verified on your profile.
          </VibelyText>
        </View>
      )}
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
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
