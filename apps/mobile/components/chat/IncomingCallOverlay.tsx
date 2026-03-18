/**
 * Full-screen overlay for incoming voice/video call. Accept / Decline; auto-decline after 30s.
 * Reference: src/components/chat/IncomingCallOverlay.tsx
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, Pressable, Image, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { VibelyText } from '@/components/ui';
import type { IncomingCallData } from '@/lib/useMatchCall';

type IncomingCallOverlayProps = {
  incomingCall: IncomingCallData;
  callerAvatarUri?: string | null;
  onAnswer: () => void;
  onDecline: () => void;
};

const RING_DURATION = 2000;

export function IncomingCallOverlay({ incomingCall, callerAvatarUri, onAnswer, onDecline }: IncomingCallOverlayProps) {
  const theme = Colors[useColorScheme()];
  const [countdown, setCountdown] = useState(30);
  const ringAnims = [useRef(new Animated.Value(1)).current, useRef(new Animated.Value(1)).current, useRef(new Animated.Value(1)).current];
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasDeclinedRef = useRef(false);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    hasDeclinedRef.current = false;
    setCountdown(30);
    intervalRef.current = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) {
          if (!hasDeclinedRef.current) {
            hasDeclinedRef.current = true;
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            onDecline();
          }
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [onDecline, incomingCall.callId]);

  useEffect(() => {
    const loops = ringAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(anim, {
            toValue: 2.2,
            duration: RING_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(anim, { toValue: 1, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal transparent visible animationType="fade">
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.88)' }]}>
        <View style={styles.content}>
          {/* Pulsing rings */}
          <View style={styles.ringWrap}>
            {ringAnims.map((anim, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.ring,
                  { borderColor: withAlpha(theme.tint, 0.31), transform: [{ scale: anim }], opacity: anim.interpolate({ inputRange: [1, 2.2], outputRange: [0.5, 0] }) },
                ]}
              />
            ))}
            <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle }]}>
              {callerAvatarUri ? (
                <Image source={{ uri: callerAvatarUri }} style={styles.avatar} />
              ) : (
                <Text style={[styles.avatarLetter, { color: theme.textSecondary }]}>{incomingCall.callerName?.[0] ?? '?'}</Text>
              )}
            </View>
          </View>

          <VibelyText variant="titleMD" style={[styles.name, { color: theme.text }]}>{incomingCall.callerName}</VibelyText>
          <View style={styles.callTypeRow}>
            <Ionicons name={incomingCall.callType === 'video' ? 'videocam' : 'call'} size={18} color={theme.textSecondary} />
            <VibelyText variant="body" style={{ color: theme.textSecondary }}>
              Incoming {incomingCall.callType} call...
            </VibelyText>
          </View>
          <VibelyText variant="caption" style={[styles.countdown, { color: theme.textSecondary }]}>{countdown}s</VibelyText>

          <View style={styles.buttons}>
            <Pressable onPress={onDecline} style={[styles.btn, styles.btnDecline]}>
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
            <Pressable onPress={onAnswer} style={[styles.btn, styles.btnAccept]}>
              <Ionicons name="call" size={28} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const AVATAR_SIZE = 96;
const RING_SIZE = AVATAR_SIZE + 16;

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  content: { alignItems: 'center', gap: spacing.md },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
  },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  avatar: { width: '100%', height: '100%' },
  avatarLetter: { fontSize: 36, fontWeight: '600' },
  name: { textAlign: 'center' },
  callTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countdown: { marginTop: 4 },
  buttons: { flexDirection: 'row', gap: spacing['2xl'], marginTop: spacing.xl },
  btn: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  btnDecline: { backgroundColor: '#ef4444' },
  btnAccept: { backgroundColor: '#22c55e' },
});