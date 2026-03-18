import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, View, ActivityIndicator } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing } from '@/constants/theme';
import { trackEvent } from '@/lib/analytics';
import { Ionicons } from '@expo/vector-icons';

const GLOW_STYLE = {
  position: 'absolute' as const,
  width: 300,
  height: 300,
  borderRadius: 150,
  backgroundColor: 'hsla(263, 70%, 66%, 0.15)',
  alignSelf: 'center' as const,
  top: '20%' as const,
  opacity: 0.6,
};

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setFieldError('');
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      setFieldError(error.message ?? 'Sign in failed');
      return;
    }
    trackEvent('login', { method: 'email' });
    setSuccess(true);
    setTimeout(() => {
      router.replace('/(tabs)');
    }, 1200);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 },
      ]}
    >
      <View style={GLOW_STYLE} pointerEvents="none" />
      {success ? (
        <View style={styles.successBlock}>
          <Ionicons name="checkmark-circle" size={72} color={theme.tint} />
          <Text style={[styles.welcomeTitle, { color: theme.text }]}>Welcome!</Text>
          <Text style={[styles.welcomeSub, { color: theme.textSecondary }]}>Taking you in…</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.brand, { color: theme.text }]}>Vibely</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Welcome back! Sign in to continue.</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldError) setFieldError('');
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            placeholder="••••••••"
            placeholderTextColor={theme.textSecondary}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (fieldError) setFieldError('');
            }}
            secureTextEntry
            editable={!loading}
          />
          {fieldError ? (
            <Text style={[styles.inlineError, { color: theme.danger }]}>{fieldError}</Text>
          ) : null}
          <Pressable
            style={[styles.button, { backgroundColor: theme.tint }, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </Pressable>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Don't have an account? Sign up</Text>
            </Pressable>
          </Link>
          <Link href="/(auth)/reset-password" asChild>
            <Pressable disabled={loading}>
              <Text style={[styles.link, { color: theme.tint }]}>Forgot password?</Text>
            </Pressable>
          </Link>
        </>
      )}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>
          By continuing, you agree to our Terms & Privacy Policy
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  brand: { fontSize: 28, fontWeight: '800', marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: 15, marginBottom: spacing.xl, textAlign: 'center', lineHeight: 22 },
  input: { borderWidth: 1, padding: 14, marginBottom: spacing.md, borderRadius: 16, minHeight: 48 },
  inlineError: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  button: { paddingVertical: 16, paddingHorizontal: spacing.xl, borderRadius: 16, alignItems: 'center', marginTop: spacing.sm, minHeight: 56 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 18 },
  link: { marginTop: spacing.sm, fontSize: 14, textAlign: 'center' },
  footer: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  footerText: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  successBlock: { alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { fontSize: 24, fontWeight: '700', marginTop: spacing.lg },
  welcomeSub: { fontSize: 15, marginTop: spacing.sm },
});
