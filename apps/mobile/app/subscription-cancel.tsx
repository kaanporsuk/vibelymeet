import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function SubscriptionCancelScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Ionicons name="close-circle-outline" size={64} color={theme.mutedForeground} />
        <Text style={[styles.title, { color: theme.text }]}>Subscription Cancelled</Text>
        <Text style={[styles.body, { color: theme.mutedForeground }]}>
          Your subscription was not completed. You can try again anytime.
        </Text>
        <VibelyButton
          label="Try Again"
          variant="primary"
          onPress={() => router.replace('/premium')}
          style={{ width: '100%', marginTop: 24 }}
        />
        <VibelyButton
          label="Go Home"
          variant="secondary"
          onPress={() => router.replace('/(tabs)')}
          style={{ width: '100%', marginTop: 12 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.xl, alignItems: 'center', maxWidth: 360 },
  title: { ...typography.titleXL, textAlign: 'center', marginTop: 24, marginBottom: 12 },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
