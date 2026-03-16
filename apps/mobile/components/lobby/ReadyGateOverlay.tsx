/**
 * Ready-gate overlay — visual parity with web: backdrop, card, partner cue, Ready / Skip.
 * Presentation only; parent wires onReady (e.g. navigate to date) and onClose.
 * Server-owned transition: parent calls onReady → navigate to date; no decision logic here.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export type ReadyGateOverlayProps = {
  sessionId: string;
  partnerName?: string | null;
  /** Optional partner avatar URL (e.g. from lobby when match opens gate). */
  partnerImageUri?: string | null;
  onReady: () => void;
  onClose: () => void;
};

export function ReadyGateOverlay({ partnerName, partnerImageUri, onReady, onClose }: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.72)' }]} pointerEvents="auto">
        <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
          <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            You matched with {partnerName || 'someone'}!
          </Text>

          <View style={[styles.avatarWrap, { borderColor: withAlpha(theme.tint, 0.31), backgroundColor: theme.surfaceSubtle }]}>
            {partnerImageUri ? (
              <Image source={{ uri: partnerImageUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={48} color={theme.textSecondary} />
            )}
          </View>

          <VibelyButton
            label="I'm Ready ✨"
            onPress={onReady}
            variant="primary"
            size="lg"
            style={styles.readyBtn}
          />
          <Pressable onPress={onClose} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
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
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl + spacing.md,
    alignItems: 'center',
  },
  title: {
    ...typography.titleLG,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  avatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  readyBtn: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
  },
  skipWrap: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  skipText: {
    fontSize: 13,
  },
});
