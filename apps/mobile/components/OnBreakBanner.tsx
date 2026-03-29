import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';

const AMBER = '#F59E0B';
const BG = 'rgba(245, 158, 11, 0.08)';
const BORDER = 'rgba(245, 158, 11, 0.25)';

type Props = {
  variant: 'full' | 'compact';
  style?: StyleProp<ViewStyle>;
};

export function OnBreakBanner({ variant, style }: Props) {
  const { isPaused, isTimedBreak, remainingLabel } = useAccountPauseStatus();

  if (!isPaused) return null;

  const line1 =
    isTimedBreak && remainingLabel ? `On a break · ${remainingLabel} left` : 'On a break';

  const padV = variant === 'full' ? 14 : 10;

  if (variant === 'compact') {
    return (
      <View style={[styles.wrap, style]}>
        <View style={[styles.inner, styles.row, { paddingVertical: padV, paddingHorizontal: 12 }]}>
          <Ionicons name="moon-outline" size={18} color={AMBER} style={styles.icon} />
          <Text style={[styles.line1, styles.line1Compact, { fontSize: 13 }]} numberOfLines={2}>
            {line1}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.inner, styles.row, { paddingVertical: padV, paddingHorizontal: 12 }]}>
        <Ionicons name="moon-outline" size={18} color={AMBER} style={styles.icon} />
        <View style={styles.textBlock}>
          <Text style={[styles.line1, { fontSize: 13 }]}>{line1}</Text>
          <Text style={[styles.line2, { fontSize: 12 }]}>
            {"You're hidden from discovery. Matches & chats are active."}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/settings/account')}
          hitSlop={8}
          style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.endBtnText}>End break</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  inner: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: { marginTop: 1 },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  line1: {
    color: AMBER,
    fontWeight: '700',
  },
  line1Compact: {
    flex: 1,
  },
  line2: {
    color: AMBER,
    fontWeight: '400',
  },
  endBtn: {
    paddingVertical: 4,
    paddingLeft: 4,
  },
  endBtnText: {
    color: AMBER,
    fontSize: 14,
    fontWeight: '600',
  },
});
