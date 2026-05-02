/**
 * Active session banner (home): live date or Ready Gate reminder.
 * Rejoin targets come from `hrefForActiveSession` in `activeSessionRoutes` (parent passes `onRejoin`).
 * End: forfeit (ready gate) or end video date + clear registration — see parent handlers.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';

type ActiveCallBannerProps = {
  sessionId: string;
  partnerName?: string | null;
  /** video = in_handshake / in_date; ready_gate = still on Ready Gate; survey = post-date verdict pending */
  mode?: 'video' | 'ready_gate' | 'survey';
  onRejoin: () => void;
  onEnd?: () => void;
};

export function ActiveCallBanner({
  sessionId: _sessionId,
  partnerName,
  mode = 'video',
  onRejoin,
  onEnd,
}: ActiveCallBannerProps) {
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

  const title =
    mode === 'ready_gate'
      ? 'Your match is waiting!'
      : mode === 'survey'
        ? 'Finish your date feedback'
        : 'You have an active date!';
  const subtitle =
    mode === 'ready_gate'
      ? partnerName
        ? `${partnerName} — tap Continue to open Ready Gate`
        : 'Tap Continue to open Ready Gate and sync up 💚'
      : mode === 'survey'
        ? 'Tell us how it went'
        : partnerName
          ? `With ${partnerName} — tap Rejoin`
          : 'Tap Rejoin to return 💚';
  const ctaLabel = mode === 'ready_gate' ? 'Continue' : mode === 'survey' ? 'Finish' : 'Rejoin';

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
                {title}
              </Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={2}>
                {subtitle}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            {onEnd ? (
              <Pressable
                onPress={onEnd}
                style={({ pressed }) => [
                  styles.endBtn,
                  { backgroundColor: withAlpha(theme.danger, 0.125) },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityLabel="End date"
              >
                <Ionicons name="close" size={18} color={theme.danger} />
              </Pressable>
            ) : null}
            <VibelyButton
              label={ctaLabel}
              onPress={onRejoin}
              variant="primary"
              size="sm"
            />
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
