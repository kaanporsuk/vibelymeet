import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { trackEvent } from '@/lib/analytics';

export default function CreditsSuccessScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { pack } = useLocalSearchParams<{ pack?: string }>();

  useEffect(() => {
    trackEvent('credit_purchase_completed', { pack: pack ?? 'unknown' });
  }, [pack]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: 'hsla(187, 94%, 43%, 0.15)' }]}>
          <Ionicons name="diamond" size={56} color={theme.neonCyan} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Credits Added!</Text>
        <Text style={[styles.body, { color: theme.mutedForeground }]}>
          Your credits are ready. During a live video date, use +2 min (Extra Time) or +5 min (Extended Vibe) when you need
          more time.
        </Text>
        <VibelyButton
          label="Got it"
          variant="gradient"
          onPress={() => router.back()}
          style={{ width: '100%', marginTop: 24 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.xl, alignItems: 'center', maxWidth: 360 },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { ...typography.titleXL, textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
