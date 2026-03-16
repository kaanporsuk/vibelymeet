import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, Alert, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, radius, layout } from '@/constants/theme';
import { trackEvent } from '@/lib/analytics';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Sign in failed', error.message);
      return;
    }
    trackEvent('login', { method: 'email' });
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 }]}>
      <Text style={[styles.title, { color: theme.text }]}>Vibely — Sign in</Text>
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        placeholder="Email"
        placeholderTextColor={theme.textSecondary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        placeholder="Password"
        placeholderTextColor={theme.textSecondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />
      <Pressable style={[styles.button, { backgroundColor: theme.tint }, loading && styles.buttonDisabled]} onPress={handleSignIn} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
      <Link href="/(auth)/sign-up" asChild>
        <Pressable>
          <Text style={[styles.link, { color: theme.tint }]}>Create an account</Text>
        </Pressable>
      </Link>
      <Link href="/(auth)/reset-password" asChild>
        <Pressable>
          <Text style={[styles.link, { color: theme.tint }]}>Forgot password?</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: spacing.xl },
  input: { borderWidth: 1, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.input, minHeight: layout.inputHeight },
  button: { paddingVertical: 14, paddingHorizontal: spacing.xl, borderRadius: radius.button, alignItems: 'center', marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { marginTop: spacing.lg },
});
