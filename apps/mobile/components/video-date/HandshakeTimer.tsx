/**
 * Circular countdown timer for handshake/date phase.
 * Colors: violet → soft pink urgency.
 * Pulses in the final 10 seconds of warm-up only.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { fonts } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const SIZE = 56;
const STROKE = 3.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Phase = 'handshake' | 'date' | 'ended';

type Props = {
  timeLeft: number;
  totalTime: number;
  phase: Phase;
};

function getTimerColor(phase: Phase, progress: number, isUrgent: boolean): string {
  if (phase === 'ended') return Colors.dark.mutedForeground;
  if (phase === 'handshake') {
    return isUrgent ? 'hsl(330, 81%, 60%)' : 'hsl(263, 70%, 66%)';
  }
  return isUrgent ? 'hsl(330, 81%, 60%)' : 'hsl(263, 70%, 66%)';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

export function HandshakeTimer({ timeLeft, totalTime, phase }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const progress = totalTime > 0 ? Math.max(0, Math.min(1, timeLeft / totalTime)) : 0;
  const isUrgent = timeLeft <= 10;
  const shouldHeartbeat = phase === 'handshake' && isUrgent;
  const color = getTimerColor(phase, progress, isUrgent);
  const offset = CIRCUMFERENCE * (1 - progress);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!shouldHeartbeat) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 300, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim, shouldHeartbeat]);

  return (
    <Animated.View style={[styles.wrap, shouldHeartbeat && { transform: [{ scale: pulseAnim }] }]}>
      <Svg width={SIZE} height={SIZE} style={styles.svg}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={theme.muted}
          strokeWidth={STROKE}
          opacity={0.3}
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={[styles.label, { color: theme.text }]}>{formatTime(timeLeft)}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
  },
  labelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.bodyBold,
  },
});
