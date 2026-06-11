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

type ActiveCallBannerProps = {
  sessionId: string;
  partnerName?: string | null;
  /** video = active entry/date; ready_gate = still on Ready Gate; survey = post-date verdict pending */
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
  const iconName =
    mode === 'ready_gate'
      ? 'timer-outline'
      : mode === 'survey'
        ? 'clipboard-outline'
        : 'videocam-outline';
  const actionLabel =
    mode === 'ready_gate'
      ? 'Open Ready Gate'
      : mode === 'survey'
        ? 'Finish date feedback'
        : 'Rejoin active date';

  return (
    <View style={styles.wrapper}>
      <View style={[styles.gradientBorder, { backgroundColor: theme.tint }]}>
        <Pressable
          onPress={onRejoin}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.inner,
            { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder },
            pressed && { opacity: 0.86 },
          ]}
        >
          <View style={styles.left}>
            <Animated.View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }, { transform: [{ scale: pulse }] }]}>
              <Ionicons name={iconName} size={20} color={theme.tint} />
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
                onPress={(event) => {
                  event.stopPropagation();
                  onEnd();
                }}
                style={({ pressed }) => [
                  styles.endBtn,
                  { backgroundColor: withAlpha(theme.danger, 0.125) },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={mode === 'ready_gate' ? 'Leave Ready Gate' : 'End date'}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={theme.danger} />
              </Pressable>
            ) : null}
            <View style={[styles.ctaPill, { backgroundColor: theme.tint }]}>
              <Text style={[styles.ctaText, { color: theme.primaryForeground }]} numberOfLines={1}>
                {ctaLabel}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.primaryForeground} />
            </View>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
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
  ctaPill: {
    minHeight: 36,
    minWidth: 86,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  ctaText: { fontSize: 14, fontWeight: '700' },
  endBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
