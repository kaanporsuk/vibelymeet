import { useState } from 'react';
import { StyleSheet, View, TextInput, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/context/AuthContext';
import { requestPasswordReset, updatePassword } from '@/lib/authApi';
import { VibelyButton } from '@/components/ui';
import { getNativePasswordResetRedirectUrl } from '@/lib/nativeAuthRedirect';

export default function ResetPasswordScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasSession = !!session?.user?.id;

  const redirectTo = getNativePasswordResetRedirectUrl();

  const handleRequestReset = async () => {
    if (!email.trim()) return;
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
    setLoading(true);
    setError(null);
    setMessage(null);
    const result = await updatePassword(newPassword);
    if (!result.ok) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    setMessage('Password updated successfully.');
    setLoading(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 }]}>
      <Text style={[styles.title, { color: theme.text }]}>Reset password</Text>
      {!hasSession ? (
        <>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>Enter your account email and we will send a reset link.</Text>
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
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>Set your new password.</Text>
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
});
