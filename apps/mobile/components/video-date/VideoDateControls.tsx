/**
 * Bottom bar: Profile, Mute, End Call (center), Camera, +Time (if credits).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onViewProfile: () => void;
  onAddTime?: () => void;
  hasCredits?: boolean;
};

export function VideoDateControls({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
  onAddTime,
  hasCredits,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const btnSize = 56;

  return (
    <View style={[styles.bar, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
      <Pressable
        onPress={onViewProfile}
        style={({ pressed }) => [
          styles.iconBtn,
          { width: btnSize, height: btnSize, backgroundColor: theme.muted },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.iconLabel}>👤</Text>
      </Pressable>

      <View style={styles.centerGroup}>
        <Pressable
          onPress={onToggleMute}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: btnSize, height: btnSize, backgroundColor: isMuted ? theme.danger : theme.muted },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.iconLabel}>{isMuted ? '🔇' : '🎤'}</Text>
        </Pressable>
        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.endBtn, pressed && styles.pressed]}
        >
          <Text style={styles.endBtnText}>📞 End</Text>
        </Pressable>
        <Pressable
          onPress={onToggleVideo}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: btnSize, height: btnSize, backgroundColor: isVideoOff ? theme.danger : theme.muted },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.iconLabel}>{isVideoOff ? '📷 Off' : '📷'}</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onAddTime}
        style={[
          styles.iconBtn,
          { width: btnSize, height: btnSize, backgroundColor: theme.muted, opacity: hasCredits ? 1 : 0.5 },
        ]}
        disabled={!hasCredits}
      >
        <Text style={styles.iconLabel}>+⏱</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  iconBtn: {
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLabel: {
    fontSize: 20,
  },
  centerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  endBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: radius.button,
    backgroundColor: 'hsl(0, 84%, 60%)',
  },
  endBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.9,
  },
});
