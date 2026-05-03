/**
 * Warm-up (handshake) Pass / Vibe strip. UI only acknowledges a choice after the
 * caller confirms the decision persisted (`recordHandshakeDecision`).
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, ActivityIndicator, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, spacing, fonts } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  timeLeft: number;
  decision?: boolean | null;
  onVibe: () => void | Promise<boolean | void>;
  onPass: () => void | Promise<boolean | void>;
  disabled?: boolean;
};

export function VibeCheckButton({ timeLeft, decision, onVibe, onPass, disabled }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [submitting, setSubmitting] = React.useState<'vibe' | 'pass' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = useRef(false);
  const isFinalTenSeconds = timeLeft <= 10;
  const hasDecided = decision === true || decision === false;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isFinalTenSeconds || hasDecided) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 410, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 410, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isFinalTenSeconds, hasDecided, pulseAnim]);

  const handlePress = async (action: 'vibe' | 'pass') => {
    if (hasDecided || disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(action);
    setError(null);
    try {
      try {
        Vibration.vibrate(30);
      } catch {
        /* ignore */
      }
      const result = await Promise.resolve(action === 'vibe' ? onVibe() : onPass());
      if (result === false) setError('Couldn’t save. Try again.');
    } catch {
      setError('Couldn’t save. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  const vibeScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  if (hasDecided) {
    return (
      <View style={styles.stripWrap}>
        <View style={[styles.lockedRow, { borderColor: theme.tint, backgroundColor: 'rgba(8,8,12,0.72)' }]}>
          <Ionicons name={decision ? 'heart' : 'close-circle'} size={18} color={theme.tint} />
          <Text style={[styles.lockedLabel, { color: theme.tint }]}>{decision ? 'Vibe saved' : 'Pass saved'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stripWrap}>
      <Text style={[styles.helper, { color: 'rgba(255,255,255,0.74)' }]}>Choose when it feels right</Text>

      <View style={[styles.row, { backgroundColor: 'rgba(10,10,16,0.62)', borderColor: theme.glassBorder }]}>
        <Pressable
          onPress={() => void handlePress('pass')}
          disabled={disabled || submitting !== null}
          accessibilityRole="button"
          accessibilityLabel="Pass"
          style={({ pressed }) => [
            styles.passShell,
            {
              borderColor: 'rgba(255,255,255,0.12)',
              backgroundColor: 'rgba(255,255,255,0.06)',
            },
            (pressed || disabled || submitting !== null) && styles.pressed,
          ]}
        >
          {submitting === 'pass' ? (
            <ActivityIndicator size="small" color={theme.mutedForeground} />
          ) : (
            <>
              <Ionicons name="close" size={18} color={theme.mutedForeground} />
              <Text style={[styles.passWord, { color: theme.mutedForeground }]}>Pass</Text>
            </>
          )}
        </Pressable>

        <Animated.View style={[styles.vibeScaleWrap, isFinalTenSeconds ? { transform: [{ scale: vibeScale }] } : null]}>
          <Pressable
            onPress={() => void handlePress('vibe')}
            disabled={disabled || submitting !== null}
            accessibilityRole="button"
            accessibilityLabel="Vibe"
            style={({ pressed }) => [styles.vibeShell, (pressed || disabled || submitting !== null) && styles.pressed]}
          >
            <LinearGradient
              colors={[theme.neonViolet, theme.neonPink]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.vibeGradient}
            >
              {submitting === 'vibe' ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <>
                  <Ionicons name="heart" size={18} color={theme.primaryForeground} style={{ marginRight: 6 }} />
                  <Text style={[styles.vibeWord, { color: theme.primaryForeground }]}>Vibe</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>

      {error ? (
        <Text style={[styles.errorText, { color: theme.neonPink }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stripWrap: {
    alignItems: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    width: '100%',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.38,
    shadowRadius: 30,
    elevation: 7,
  },
  passShell: {
    flex: 1,
    maxWidth: 145,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  vibeShell: {
    flex: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  vibeScaleWrap: {
    flex: 1.12,
    maxWidth: 155,
  },
  vibeGradient: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  passWord: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  vibeWord: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: 'hsl(263, 70%, 66%)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 5,
  },
  lockedLabel: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  helper: {
    fontSize: 12,
    lineHeight: 15,
    fontFamily: fonts.bodySemiBold,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.bodySemiBold,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
