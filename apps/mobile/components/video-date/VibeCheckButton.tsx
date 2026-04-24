/**
 * Handshake decision controls. UI only acknowledges a Vibe/Pass after the
 * caller confirms the actor's decision persisted.
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, Vibration } from 'react-native';
import { radius, spacing, fonts } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  timeLeft: number;
  decision?: boolean | null;
  onVibe: () => void | Promise<boolean | void>;
  onPass: () => void | Promise<boolean | void>;
  disabled?: boolean;
  /** Non-null during handshake grace when the local user still needs to decide. */
  graceSecondsRemaining?: number | null;
};

export function VibeCheckButton({ timeLeft, decision, onVibe, onPass, disabled, graceSecondsRemaining }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [submitting, setSubmitting] = React.useState<'vibe' | 'pass' | null>(null);
  const submittingRef = useRef(false);
  const inGrace = graceSecondsRemaining != null;
  const isProminent = inGrace || timeLeft <= 20;
  const hasDecided = decision === true || decision === false;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const lastChanceFlash = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isProminent || hasDecided) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isProminent, hasDecided, pulseAnim]);

  useEffect(() => {
    if (!inGrace || hasDecided) {
      lastChanceFlash.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(lastChanceFlash, { toValue: 0.35, duration: 320, useNativeDriver: true }),
        Animated.timing(lastChanceFlash, { toValue: 1, duration: 320, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      lastChanceFlash.setValue(1);
    };
  }, [inGrace, hasDecided, lastChanceFlash]);

  const handlePress = async (action: 'vibe' | 'pass') => {
    if (hasDecided || disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(action);
    try {
      try {
        Vibration.vibrate(30);
      } catch {}
      const result = await Promise.resolve(action === 'vibe' ? onVibe() : onPass());
      if (result === false) return;
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  if (hasDecided) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.savedButton, { borderColor: theme.tint, backgroundColor: theme.tintSoft }]}>
          <Text style={[styles.savedText, { color: theme.tint }]}>{decision ? 'Vibed' : 'Passed'}</Text>
        </View>
        <Text style={[styles.hint, { color: theme.mutedForeground }]}>Waiting for your match...</Text>
      </View>
    );
  }

  const animatedScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  const lastChanceLabelOpacity = inGrace && !hasDecided ? lastChanceFlash : 1;

  return (
    <View style={styles.wrap}>
      {inGrace && !hasDecided ? (
        <Animated.Text
          style={[
            styles.lastChanceTitle,
            { color: theme.tint, opacity: lastChanceLabelOpacity },
          ]}
        >
          Last Chance
        </Animated.Text>
      ) : null}
      <Text style={[styles.cta, { color: theme.text }]}>Vibe or Pass to continue</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => void handlePress('pass')}
          disabled={disabled || submitting !== null}
          style={({ pressed }) => [
            styles.actionButton,
            styles.passButton,
            { borderColor: theme.border, backgroundColor: theme.muted },
            (pressed || disabled || submitting !== null) && styles.pressed,
          ]}
        >
          <Text style={[styles.passLabel, { color: theme.mutedForeground }]}>
            {submitting === 'pass' ? 'Saving...' : 'Pass'}
          </Text>
        </Pressable>
        <Animated.View style={[styles.actionButton, styles.vibeButton, { backgroundColor: theme.tint, borderColor: theme.tint }, isProminent && { transform: [{ scale: animatedScale }] }]}>
          <Pressable
            onPress={() => void handlePress('vibe')}
            disabled={disabled || submitting !== null}
            style={({ pressed }) => [StyleSheet.absoluteFill, pressed && styles.pressed]}
          >
            <View style={styles.inner}>
              <Text style={[styles.vibeLabel, { color: theme.primaryForeground }]}>
                {submitting === 'vibe' ? 'Saving...' : 'Vibe'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
      <Text style={[styles.hint, { color: inGrace ? theme.tint : theme.mutedForeground }]}>
        {inGrace
          ? `${graceSecondsRemaining}s left to choose.`
          : isProminent
            ? 'Last chance: choose before the timer ends.'
            : 'Your choice only continues after it saves.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  lastChanceTitle: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontFamily: fonts.bodyBold,
    textAlign: 'center',
    marginBottom: 2,
  },
  cta: {
    maxWidth: 240,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.bodySemiBold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    minWidth: 104,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passButton: {
    borderWidth: 1,
  },
  vibeButton: {},
  savedButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 140,
    alignItems: 'center',
  },
  savedText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  pressed: {
    opacity: 0.65,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passLabel: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  vibeLabel: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  hint: {
    maxWidth: 240,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.body,
  },
});
