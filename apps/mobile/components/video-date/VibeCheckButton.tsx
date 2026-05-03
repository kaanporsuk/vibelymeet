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

function formatWarmHint(
  isFinalTenSeconds: boolean,
  hasDecided: boolean
): string | null {
  if (hasDecided) return null;
  if (isFinalTenSeconds) return 'A quiet nudge before warm-up ends';
  return null;
}

export function VibeCheckButton({ timeLeft, decision, onVibe, onPass, disabled }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [submitting, setSubmitting] = React.useState<'vibe' | 'pass' | null>(null);
  const submittingRef = useRef(false);
  const isFinalTenSeconds = timeLeft <= 10;
  const hasDecided = decision === true || decision === false;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const lastChanceFlash = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    if (!isFinalTenSeconds || hasDecided) {
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
  }, [isFinalTenSeconds, hasDecided, lastChanceFlash]);

  const handlePress = async (action: 'vibe' | 'pass') => {
    if (hasDecided || disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(action);
    try {
      try {
        Vibration.vibrate(30);
      } catch {
        /* ignore */
      }
      const result = await Promise.resolve(action === 'vibe' ? onVibe() : onPass());
      if (result === false) return;
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  const hint = formatWarmHint(isFinalTenSeconds, hasDecided);
  const vibeScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const lastChanceLabelOpacity = isFinalTenSeconds && !hasDecided ? lastChanceFlash : 1;

  if (hasDecided) {
    return (
      <View style={styles.stripWrap}>
        <View style={[styles.lockedRow, { borderColor: theme.tint, backgroundColor: 'rgba(8,8,12,0.72)' }]}>
          <Ionicons name={decision ? 'heart' : 'close-circle'} size={18} color={theme.tint} />
          <Text style={[styles.lockedLabel, { color: theme.tint }]}>{decision ? 'Vibed' : 'Passed'}</Text>
        </View>
        <Text style={[styles.waitingLine, { color: theme.mutedForeground }]}>Waiting softly for your match…</Text>
      </View>
    );
  }

  return (
    <View style={styles.stripWrap}>
      {isFinalTenSeconds && !hasDecided ? (
        <Animated.Text
          style={[styles.lastChanceTag, { color: theme.neonPink, opacity: lastChanceLabelOpacity }]}
        >
          Warm-up ending
        </Animated.Text>
      ) : null}

      <View style={[styles.row, { backgroundColor: 'rgba(0,0,0,0.34)', borderColor: theme.glassBorder }]}>
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

        <Animated.View style={isFinalTenSeconds ? { transform: [{ scale: vibeScale }] } : undefined}>
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

      {hint ? (
        <Text style={[styles.hint, { color: isFinalTenSeconds ? theme.neonPink : theme.mutedForeground }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stripWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
    maxWidth: 370,
    alignSelf: 'center',
  },
  lastChanceTag: {
    fontSize: 11,
    letterSpacing: 2,
    fontFamily: fonts.bodyBold,
    textTransform: 'uppercase',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(236,72,153,0.12)',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    width: '100%',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.34,
    shadowRadius: 28,
    elevation: 7,
  },
  passShell: {
    flex: 1,
    maxWidth: 148,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 50,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  vibeShell: {
    flex: 1,
    maxWidth: 168,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  vibeGradient: {
    minHeight: 50,
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
  waitingLine: {
    fontSize: 11,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  hint: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.72,
  },
});
