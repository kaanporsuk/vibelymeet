/**
 * Shown when the event ends (admin or time). "Event Over" with View Matches and Go Home.
 * Reference: src/components/events/EventEndedModal.tsx
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  isOpen: boolean;
};

export function EventEndedModal({ isOpen }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const goMatches = () => {
    router.replace('/(tabs)/matches');
  };

  const goHome = () => {
    router.replace('/(tabs)');
  };

  return (
    <Modal visible={isOpen} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={[styles.title, { color: theme.text }]}>Thanks for joining!</Text>
          <Text style={[styles.message, { color: theme.mutedForeground }]}>
            This event has ended 💚 Check your matches to keep the conversation going.
          </Text>
          <Pressable
            onPress={goMatches}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.tint }, pressed && styles.pressed]}
          >
            <Text style={styles.primaryBtnText}>View Matches</Text>
          </Pressable>
          <Pressable
            onPress={goHome}
            style={({ pressed }) => [styles.secondaryBtn, { borderColor: theme.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Go Home</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius['3xl'],
    borderWidth: 1,
    padding: spacing['2xl'],
    alignItems: 'center',
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius['2xl'],
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.9,
  },
});
