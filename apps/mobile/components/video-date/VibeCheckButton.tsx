/**
 * Warm-up (handshake) Pass / Vibe strip. UI only acknowledges a choice after the
 * caller confirms the decision persisted (`recordHandshakeDecision`).
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, ActivityIndicator, Vibration, useWindowDimensions } from 'react-native';
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
  localHasDecided?: boolean;
  partnerHasDecided?: boolean;
};

const RAIL_MAX_WIDTH = 320;
const RAIL_MIN_WIDTH = 264;
const RAIL_SCREEN_GUTTER = 64;
const RAIL_HORIZONTAL_PADDING = 6;
const RAIL_BUTTON_GAP = 8;
const PASS_BUTTON_RATIO = 0.47;
const BUTTON_HEIGHT = 52;

export function VibeCheckButton({
  timeLeft,
  decision,
  onVibe,
  onPass,
  disabled,
  localHasDecided,
  partnerHasDecided = false,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { width: viewportWidth } = useWindowDimensions();
  const [submitting, setSubmitting] = React.useState<'vibe' | 'pass' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = useRef(false);
  const isFinalTenSeconds = timeLeft <= 10;
  const hasDecided = localHasDecided ?? (decision === true || decision === false);
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

  const railWidth = Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.floor(viewportWidth - RAIL_SCREEN_GUTTER)));
  const buttonContentWidth = railWidth - RAIL_HORIZONTAL_PADDING * 2 - RAIL_BUTTON_GAP;
  const passButtonWidth = Math.floor(buttonContentWidth * PASS_BUTTON_RATIO);
  const vibeButtonWidth = buttonContentWidth - passButtonWidth;

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
          <Text
            style={[styles.lockedLabel, { color: theme.tint }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.86}
          >
            {decision === false ? 'Pass saved' : 'Ready to continue'}
          </Text>
        </View>
        <Text
          style={[styles.partnerHint, { color: 'rgba(255,255,255,0.58)' }]}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.88}
        >
          {partnerHasDecided ? "They've chosen too" : 'Waiting for them'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stripWrap}>
      <View
        style={[
          styles.row,
          {
            width: railWidth,
            backgroundColor: 'rgba(10,10,16,0.62)',
            borderColor: theme.glassBorder,
          },
        ]}
      >
        <Pressable
          onPress={() => void handlePress('pass')}
          disabled={disabled || submitting !== null}
          accessibilityRole="button"
          accessibilityLabel="Pass"
          style={({ pressed }) => [
            styles.passShell,
            { width: passButtonWidth },
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
              <Text
                style={[styles.passWord, { color: theme.mutedForeground }]}
                numberOfLines={1}
                ellipsizeMode="tail"
                adjustsFontSizeToFit
                minimumFontScale={0.86}
              >
                Pass
              </Text>
            </>
          )}
        </Pressable>

        <Animated.View
          style={[
            styles.vibeScaleWrap,
            { width: vibeButtonWidth },
            isFinalTenSeconds ? { transform: [{ scale: vibeScale }] } : null,
          ]}
        >
          <Pressable
            onPress={() => void handlePress('vibe')}
            disabled={disabled || submitting !== null}
            accessibilityRole="button"
            accessibilityLabel="Continue when ready"
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
                  <Text
                    style={[styles.vibeWord, { color: theme.primaryForeground }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    adjustsFontSizeToFit
                    minimumFontScale={0.86}
                  >
                    Continue
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>

      <Text
        style={[styles.helper, { color: 'rgba(255,255,255,0.54)' }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.88}
      >
        {partnerHasDecided ? "They've chosen" : 'Continue when ready'}
      </Text>

      {error ? (
        <Text style={[styles.errorText, { color: theme.neonPink }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stripWrap: {
    alignItems: 'center',
    width: '100%',
    maxWidth: RAIL_MAX_WIDTH,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RAIL_BUTTON_GAP,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: RAIL_HORIZONTAL_PADDING,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 5,
  },
  passShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: BUTTON_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  vibeShell: {
    width: '100%',
    height: BUTTON_HEIGHT,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  vibeScaleWrap: {
    height: BUTTON_HEIGHT,
  },
  vibeGradient: {
    height: BUTTON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
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
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.bodyMedium,
    textAlign: 'center',
    marginTop: 6,
  },
  partnerHint: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.bodyMedium,
    textAlign: 'center',
    marginTop: 6,
  },
  errorText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.bodySemiBold,
    textAlign: 'center',
    marginTop: 4,
  },
  pressed: {
    opacity: 0.72,
  },
});
