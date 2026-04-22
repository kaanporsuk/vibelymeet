/**
 * Vibe check button: subtle until 20s left, then prominent with pulse.
 * Tapping records participant_X_liked (partner is never notified).
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, Vibration } from 'react-native';
import { radius, spacing, fonts } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  timeLeft: number;
  /** Return false if the server rejected the vibe (UI stays tappable). */
  onVibe: () => void | Promise<boolean | void>;
  disabled?: boolean;
};

export function VibeCheckButton({ timeLeft, onVibe, disabled }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [hasVibed, setHasVibed] = React.useState(false);
  const submittingRef = useRef(false);
  const isProminent = timeLeft <= 20;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isProminent || hasVibed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isProminent, hasVibed, pulseAnim]);

  const handlePress = async () => {
    if (hasVibed || disabled || submittingRef.current) return;
    submittingRef.current = true;
    try {
      try {
        Vibration.vibrate(30);
      } catch {}
      const result = await Promise.resolve(onVibe());
      if (result === false) return;
      setHasVibed(true);
    } finally {
      submittingRef.current = false;
    }
  };

  if (hasVibed) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.button, styles.vibedButton, { borderColor: theme.tint, backgroundColor: theme.tintSoft }]}>
          <Text style={[styles.vibedText, { color: theme.tint }]}>✓ Vibed</Text>
        </View>
        <Text style={[styles.hint, { color: theme.mutedForeground }]}>Waiting for them to tap Vibe too.</Text>
      </View>
    );
  }

  const buttonStyle = isProminent
    ? [styles.button, styles.prominent, { backgroundColor: theme.tint, borderColor: theme.tint }]
    : [styles.button, styles.subtle, { borderColor: theme.border, backgroundColor: theme.muted }];

  const animatedScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[buttonStyle, isProminent && { transform: [{ scale: animatedScale }] }]}>
        <Pressable
          onPress={handlePress}
          disabled={disabled}
          style={({ pressed }) => [StyleSheet.absoluteFill, pressed && styles.pressed]}
        >
          <View style={styles.inner}>
            <Text style={[styles.label, isProminent ? { color: theme.primaryForeground } : { color: theme.mutedForeground }]}>
              Tap Vibe
            </Text>
          </View>
        </Pressable>
      </Animated.View>
      <Text style={[styles.hint, { color: theme.mutedForeground }]}>
        {isProminent
          ? 'Last chance: you both need to tap Vibe to keep going.'
          : 'Both of you need to tap Vibe to continue to the full date.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 2,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtle: {
    opacity: 0.85,
  },
  prominent: {},
  vibedButton: {
    borderWidth: 1,
  },
  vibedText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  pressed: {
    opacity: 0.9,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
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
