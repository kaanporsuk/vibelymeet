/**
 * Active call rejoin banner — parity with web: "You have an active date!", Rejoin / End.
 * Premium glass treatment; Rejoin -> /date/[sessionId], End -> best-effort end + clear registration.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';

type ActiveCallBannerProps = {
  sessionId: string;
  partnerName?: string | null;
  onRejoin: () => void;
  onEnd: () => void;
};

export function ActiveCallBanner({ sessionId, partnerName, onRejoin, onEnd }: ActiveCallBannerProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={[styles.wrapper, { paddingTop: 8 }]}>
      <View style={[styles.gradientBorder, { backgroundColor: theme.tint }]}>
        <View style={[styles.inner, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <View style={styles.left}>
            <Animated.View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }, { transform: [{ scale: pulse }] }]}>
              <Ionicons name="videocam" size={20} color={theme.tint} />
            </Animated.View>
            <View style={styles.textWrap}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                You have an active date!
              </Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
                {partnerName ? `With ${partnerName}` : 'Tap to rejoin'} 💚
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={onEnd}
              style={({ pressed }) => [
                styles.endBtn,
                { backgroundColor: theme.danger + '20' },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityLabel="End date"
            >
              <Ionicons name="close" size={18} color={theme.danger} />
            </Pressable>
            <VibelyButton label="Rejoin" onPress={onRejoin} variant="primary" size="sm" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    paddingHorizontal: spacing.lg,
  },
  gradientBorder: {
    borderRadius: radius['2xl'],
    padding: 1,
  },
  inner: {
    borderRadius: radius['2xl'] - 1,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, minWidth: 0 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  endBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
