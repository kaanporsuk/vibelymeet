import { useEffect, useState } from 'react';
import { StyleSheet, View, TextInput, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { requestPasswordReset, updatePassword } from '@/lib/authApi';
import { VibelyButton } from '@/components/ui';
import { getNativePasswordResetRedirectUrl } from '@/lib/nativeAuthRedirect';
import {
  isPasswordRecoveryStatus,
  type PasswordRecoveryStatus,
} from '@shared/authRedirect';

const WEB_APP_ORIGIN = (process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://vibelymeet.com').replace(/\/$/, '');

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    authError?: string | string[];
    recovery?: PasswordRecoveryStatus | string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const authLinkError = firstRouteParam(params.authError);
  const recoveryParam = firstRouteParam(params.recovery);
  const recoveryStatus = isPasswordRecoveryStatus(recoveryParam)
    ? recoveryParam
    : 'none';
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  const recoveryReady = recoveryStatus === 'ready';

  const redirectTo = getNativePasswordResetRedirectUrl();

  useEffect(() => {
    if (recoveryStatus === 'invalid') {
      setError(authLinkError ?? 'That recovery link is invalid or expired.');
      setMessage('Request a fresh reset email below.');
      return;
    }

    if (authLinkError) {
      setError(authLinkError);
      setMessage('Request a fresh reset email below.');
      return;
    }

    setError(null);
    setMessage(null);
  }, [authLinkError, recoveryStatus]);

  useEffect(() => {
    if (!passwordUpdated) return;
    const timer = setTimeout(() => {
      router.replace('/');
    }, 900);
    return () => clearTimeout(timer);
  }, [passwordUpdated]);

  const handleRequestReset = async () => {
    if (!email.trim()) return;
    setPasswordUpdated(false);
    setLoading(true);
    setError(null);
    setMessage(null);
    const result = await requestPasswordReset(email.trim(), redirectTo);
    if (!result.ok) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    setMessage('Reset link sent. Open the email link on this device. Vibely will switch this screen into password update mode once the recovery session is ready.');
    setLoading(false);
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setPasswordUpdated(false);
    setLoading(true);
    setError(null);
    setMessage(null);
    const result = await updatePassword(newPassword);
    if (!result.ok) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    setPasswordUpdated(true);
    setMessage('Password updated successfully. Redirecting to Vibely...');
    setLoading(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 }]}>
      <Text style={[styles.title, { color: theme.text }]}>Reset password</Text>
      {!recoveryReady ? (
        <>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            {recoveryStatus === 'invalid'
              ? 'This recovery link can no longer be used. Request a fresh reset email.'
              : 'Enter your account email and we will send a reset link.'}
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <VibelyButton label={loading ? 'Sending...' : 'Send reset link'} onPress={handleRequestReset} disabled={loading || !email.trim()} />
        </>
      ) : (
        <>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            Set your new password. Your current password is not required in recovery mode.
          </Text>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="New password"
            secureTextEntry
            autoCapitalize="none"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            secureTextEntry
            autoCapitalize="none"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <VibelyButton
            label={loading ? 'Updating...' : 'Update password'}
            onPress={handleUpdatePassword}
            disabled={loading || !newPassword || !confirmPassword}
          />
        </>
      )}

      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      {message ? <Text style={[styles.success, { color: theme.tint }]}>{message}</Text> : null}
      {recoveryReady && passwordUpdated ? (
        <VibelyButton
          label="Continue now"
          onPress={() => router.replace('/')}
          variant="secondary"
          style={{ marginTop: 16 }}
        />
      ) : null}

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

      <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={{ marginTop: 18 }}>
        <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  placeholder: { opacity: 0.8, fontSize: 14, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  error: { fontSize: 13, marginTop: 10 },
  success: { fontSize: 13, marginTop: 10 },
  legalNotice: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  legalLink: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
