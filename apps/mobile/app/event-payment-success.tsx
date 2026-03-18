import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function EventPaymentSuccessScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const id = typeof eventId === 'string' ? eventId : eventId?.[0];

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: 'hsla(263, 70%, 66%, 0.15)' }]}>
          <Ionicons name="ticket" size={56} color={theme.tint} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{"You're In!"}</Text>
        <Text style={[styles.body, { color: theme.mutedForeground }]}>
          Your spot is confirmed. Get ready for an amazing event!
        </Text>
        {id ? (
          <VibelyButton
            label="View Event"
            variant="gradient"
            onPress={() => router.replace(`/(tabs)/events/${id}` as const)}
            style={{ width: '100%', marginTop: 24 }}
          />
        ) : null}
        <VibelyButton
          label="Back to Events"
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
