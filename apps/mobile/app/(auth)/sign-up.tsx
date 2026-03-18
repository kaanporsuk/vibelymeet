import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, View, ActivityIndicator } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, radius, layout } from '@/constants/theme';
import { trackEvent } from '@/lib/analytics';

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

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const handleSignUp = async () => {
    if (!email.trim() || !password) return;
    setFieldError('');
    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      setFieldError(error.message ?? 'Sign up failed');
      return;
    }
    trackEvent('signup_completed', { method: 'email' });
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 }]}>
      <Text style={[styles.brand, { color: theme.text }]}>Vibely</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Create your account to get started.</Text>
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
        placeholder="Password"
        placeholderTextColor={theme.textSecondary}
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (fieldError) setFieldError('');
        }}
        secureTextEntry
        editable={!loading}
      />
      <Pressable style={[styles.button, { backgroundColor: theme.tint }, loading && styles.buttonDisabled]} onPress={handleSignUp} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating account…' : 'Create Account'}</Text>
      </Pressable>
      <Link href="/(auth)/sign-in" asChild>
        <Pressable disabled={loading}>
          <Text style={[styles.link, { color: theme.tint }]}>Already have an account? Sign in</Text>
        </Pressable>
      </Link>
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
  input: { borderWidth: 1, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.input, minHeight: layout.inputHeight },
  button: { paddingVertical: 14, paddingHorizontal: spacing.xl, borderRadius: radius.button, alignItems: 'center', marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 18 },
  link: { marginTop: spacing.sm, fontSize: 14 },
  footer: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  footerText: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
