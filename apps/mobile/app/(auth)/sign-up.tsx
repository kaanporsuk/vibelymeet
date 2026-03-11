import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vibely — Sign up</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />
      <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignUp} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating account…' : 'Sign up'}</Text>
      </Pressable>
      <Link href="/(auth)/sign-in" asChild>
        <Pressable>
          <Text style={styles.link}>Already have an account? Sign in</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 24 },
  input: { borderWidth: 1, padding: 12, marginBottom: 12, borderRadius: 8 },
  button: { backgroundColor: '#2f95dc', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  link: { color: '#2f95dc', marginTop: 16 },
});
