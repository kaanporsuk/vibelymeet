import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, Alert, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

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
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 24 },
  input: { borderWidth: 1, padding: 12, marginBottom: 12, borderRadius: 8 },
  button: { padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  link: { marginTop: 16 },
});
