import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function SubscriptionSuccessScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: 'hsla(263, 70%, 66%, 0.15)' }]}>
          <Ionicons name="checkmark-circle" size={64} color={theme.tint} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Welcome to Premium!</Text>
        <Text style={[styles.body, { color: theme.mutedForeground }]}>
          You now have access to all premium features. Enjoy unlimited events, priority matching, and more.
        </Text>
        <VibelyButton
          label="Start Exploring"
          variant="gradient"
          onPress={() => router.replace('/(tabs)' as const)}
          style={{ width: '100%', marginTop: 24 }}
        />
        <VibelyButton
          label="View Events"
          variant="secondary"
          onPress={() => router.replace('/(tabs)/events' as const)}
          style={{ width: '100%', marginTop: 12 }}
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
