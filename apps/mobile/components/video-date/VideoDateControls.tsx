/**
 * Bottom bar: Profile, Mute, End Call (center), Camera, +Time (date phase only when wired).
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
  /** In-call safety report (`submit_user_report`). Omit when not in active call. */
  onSafety?: () => void;
  /** During date: opens credits or highlights in-call add-time controls. Omit during handshake to reserve layout. */
  onAddTime?: () => void;
  /** Shapes accessibility label when onAddTime is set (credits vs get-credits path). */
  hasCredits?: boolean;
};

export function VideoDateControls({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
  onSafety,
  onAddTime,
  hasCredits,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const btnSize = 56;
  const addTimeLabel = hasCredits
    ? 'Add time: use the plus two or plus five minute buttons above'
    : 'Get video date credits to add time';

  return (
    <View style={[styles.bar, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
      <View style={styles.leftGroup}>
        <Pressable
          onPress={onViewProfile}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: btnSize, height: btnSize, backgroundColor: theme.muted },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="View profile"
        >
          <Text style={styles.iconLabel}>👤</Text>
        </Pressable>
        {onSafety ? (
          <Pressable
            onPress={onSafety}
            style={({ pressed }) => [
              styles.iconBtn,
              { width: btnSize, height: btnSize, backgroundColor: theme.muted },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Safety and report"
          >
            <Text style={styles.iconLabel}>🛡️</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.centerGroup}>
        <Pressable
          onPress={onToggleMute}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: btnSize, height: btnSize, backgroundColor: isMuted ? theme.danger : theme.muted },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Text style={styles.iconLabel}>{isMuted ? '🔇' : '🎤'}</Text>
        </Pressable>
        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.endBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="End call"
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
          accessibilityRole="button"
          accessibilityLabel={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
        >
          <Text style={styles.iconLabel}>{isVideoOff ? '📷 Off' : '📷'}</Text>
        </Pressable>
      </View>

      {onAddTime ? (
        <Pressable
          onPress={onAddTime}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: btnSize, height: btnSize, backgroundColor: theme.muted },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={addTimeLabel}
          accessibilityHint={hasCredits ? undefined : 'Opens video date credits in settings'}
        >
          <Text style={styles.iconLabel}>+⏱</Text>
        </Pressable>
      ) : (
        <View style={{ width: btnSize, height: btnSize }} accessibilityElementsHidden />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
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
