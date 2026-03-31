import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailCollectionStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const theme = Colors[useColorScheme()];
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const valid = useMemo(() => EMAIL_RE.test(email.trim()), [email]);

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      setMessage(`We sent a confirmation link to ${email.trim()}. You can verify it anytime.`);
      setTimeout(onNext, 2000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Add your email</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>For account recovery and important updates. We'll never spam you.</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="you@example.com"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
      {message ? <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{message}</Text> : null}
      <VibelyButton label={loading ? 'Saving...' : 'Continue'} onPress={submit} disabled={!valid || loading} variant="gradient" />
      <Pressable onPress={onSkip}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Skip for now</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, input: { borderWidth: 1, borderRadius: 14, minHeight: 48, paddingHorizontal: 12 } });
