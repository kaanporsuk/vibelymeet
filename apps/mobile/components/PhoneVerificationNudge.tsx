/**
 * Phone verification nudge — native parity; launches the canonical native OTP flow.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius } from '@/constants/theme';

type Variant = 'wizard' | 'match' | 'event' | 'empty';

const COPY: Record<Variant, { emoji: string; title: string; subtitle: string; cta: string; dismiss: string }> = {
  wizard: {
    emoji: '🔒',
    title: 'One more thing — verify your phone to get a trust badge',
    subtitle: 'Verified profiles get 2x more matches',
    cta: 'Verify phone number',
    dismiss: 'Maybe Later',
  },
  match: {
    emoji: '💜',
    title: 'Congrats on your first match! Boost your profile with phone verification',
    subtitle: '',
    cta: 'Verify phone number',
    dismiss: 'Skip',
  },
  event: {
    emoji: '📱',
    title: 'Tip: Verified profiles are shown first in the event lobby',
    subtitle: '',
    cta: 'Verify phone number',
    dismiss: '',
  },
  empty: {
    emoji: '📱',
    title: 'No matches yet — verify your phone to boost your visibility',
    subtitle: '',
    cta: 'Verify phone number',
    dismiss: '',
  },
};

type PhoneVerificationNudgeProps = {
  variant: Variant;
  onDismiss?: () => void;
  /** Opens the canonical native phone verification flow. */
  onVerify?: () => void;
  /** Back-compat: fired on CTA tap (previously used for web handoff). */
  onVerified?: () => void;
};

export function PhoneVerificationNudge({ variant, onDismiss, onVerify, onVerified }: PhoneVerificationNudgeProps) {
  const theme = Colors[useColorScheme()];
  const [dismissed, setDismissed] = useState(false);
  const copy = COPY[variant];

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const handleVerify = () => {
    setDismissed(true);
    onVerify?.();
    onVerified?.();
  };

  if (dismissed) return null;

  return (
    <Card variant="glass" style={[styles.card, { borderColor: withAlpha(theme.tint, 0.25) }]}>
      {variant === 'event' && (
        <Pressable style={styles.dismissBtn} onPress={handleDismiss} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
      <View style={styles.row}>
        <View style={[styles.emojiWrap, { backgroundColor: theme.tintSoft }]}>
          <Text style={styles.emoji}>{copy.emoji}</Text>
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: theme.text }]}>{copy.title}</Text>
          {copy.subtitle ? <Text style={[styles.sub, { color: theme.textSecondary }]}>{copy.subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <VibelyButton
          label={copy.cta}
          onPress={handleVerify}
          variant="primary"
          size="sm"
          style={styles.ctaBtn}
        />
        {copy.dismiss ? (
          <Pressable onPress={handleDismiss} style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.8 }]}>
            <Text style={[styles.skipText, { color: theme.textSecondary }]}>{copy.dismiss}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, marginBottom: spacing.md, position: 'relative' },
  dismissBtn: { position: 'absolute', top: spacing.sm, right: spacing.sm, zIndex: 1, padding: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  emojiWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22 },
  textWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  sub: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  ctaBtn: {},
  skipBtn: { paddingVertical: 6, paddingHorizontal: spacing.sm },
  skipText: { fontSize: 13 },
});
