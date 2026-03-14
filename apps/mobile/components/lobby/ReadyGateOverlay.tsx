/**
 * Ready-gate overlay — visual parity with web: backdrop, card, partner cue, Ready / Skip.
 * Presentation only; parent wires onReady (e.g. navigate to date) and onClose.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export type ReadyGateOverlayProps = {
  sessionId: string;
  partnerName?: string | null;
  onReady: () => void;
  onClose: () => void;
};

export function ReadyGateOverlay({ partnerName, onReady, onClose }: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
        <Card style={[styles.card, { borderColor: theme.glassBorder }]}>
          <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            You matched with {partnerName || 'someone'}!
          </Text>

          <View style={[styles.avatarPlaceholder, { backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="person" size={48} color={theme.textSecondary} />
          </View>

          <VibelyButton
            label="I'm Ready ✨"
            onPress={onReady}
            variant="primary"
            style={styles.readyBtn}
          />
          <Pressable onPress={onClose} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
            <Text style={[styles.skipText, { color: theme.textSecondary }]}>Skip this one</Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  avatarPlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  readyBtn: {
    marginBottom: spacing.md,
  },
  skipText: {
    fontSize: 12,
  },
});
