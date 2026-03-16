/**
 * Circular countdown timer for handshake/date phase.
 * Colors: cyan → violet → pink → red (handshake); green/violet → red (date).
 * Pulses in final 10 seconds.
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
    if (isUrgent) return 'hsl(0, 84%, 60%)';
    if (progress > 2 / 3) return 'hsl(187, 94%, 43%)';
    if (progress > 1 / 3) return 'hsl(263, 70%, 66%)';
    return 'hsl(330, 81%, 60%)';
  }
  if (isUrgent) return 'hsl(0, 84%, 60%)';
  if (progress > 0.5) return '#22c55e';
  return 'hsl(263, 70%, 66%)';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

export function HandshakeTimer({ timeLeft, totalTime, phase }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const progress = totalTime > 0 ? timeLeft / totalTime : 0;
  const isUrgent = timeLeft <= 10;
  const color = getTimerColor(phase, progress, isUrgent);
  const offset = CIRCUMFERENCE * (1 - progress);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isUrgent || phase === 'ended') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 300, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isUrgent, phase, pulseAnim]);

  return (
    <Animated.View style={[styles.wrap, isUrgent && { transform: [{ scale: pulseAnim }] }]}>
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
