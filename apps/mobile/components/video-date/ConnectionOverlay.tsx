/**
 * Shown while connecting to Daily room. Pulsing rings + "Connecting you..." message.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { typography, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';

/** `joining` = token/handshake/Daily connect; `waiting_peer` = local in room, peer not yet observed. */
export type ConnectionOverlayMode = 'joining' | 'waiting_peer';

type Props = {
  /** @deprecated Prefer `mode` — when set, overrides `isConnecting` mapping. */
  isConnecting?: boolean;
  mode?: ConnectionOverlayMode;
  onLeave: () => void;
};

export function ConnectionOverlay({ isConnecting, mode, onLeave }: Props) {
  const resolvedMode: ConnectionOverlayMode =
    mode ?? (isConnecting ? 'joining' : 'waiting_peer');
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim1 = Animated.loop(
      Animated.sequence([
        Animated.timing(ring1, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(ring1, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    const anim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(ring2, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(ring2, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    anim1.start();
    anim2.start();
    return () => {
      anim1.stop();
      anim2.stop();
    };
  }, [ring1, ring2]);

  return (
    <View style={styles.overlay}>
      <View style={styles.content}>
        <View style={styles.ringsWrap}>
          <Animated.View
            style={[
              styles.ring,
              { borderColor: theme.tint, opacity: 0.5 },
              { transform: [{ scale: ring1 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.ring,
              { borderColor: theme.tint, opacity: 0.5 },
              { transform: [{ scale: ring2 }] },
            ]}
          />
          <View style={[styles.centerDot, { backgroundColor: withAlpha(theme.tint, 0.19) }]}>
            <View style={[styles.innerDot, { backgroundColor: theme.tint }]} />
          </View>
        </View>
        <Text style={[styles.title, { color: theme.text }]}>
          {resolvedMode === 'joining' ? 'Joining your date...' : 'Waiting for your match...'}
        </Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
          {resolvedMode === 'joining'
            ? 'Setting up your video room'
            : 'Your date timer starts once they join the same room.'}
        </Text>
        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.leaveBtn, { borderColor: theme.border }, pressed && styles.pressed]}
        >
          <Text style={[styles.leaveBtnText, { color: theme.text }]}>Leave</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    maxWidth: 320,
  },
  ringsWrap: {
    width: 96,
    height: 96,
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
  },
  centerDot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  leaveBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
  },
  leaveBtnText: {
    ...typography.body,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
  },
});
