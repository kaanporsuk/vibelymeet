/**
 * Bottom dock: Profile, Mic, Leave (center), Camera, Safety.
 * Icon-only; Leave uses destructive styling. Optional +Time is surfaced by the screen (not in this row).
 */

import React from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const COMPACT_DOCK_WIDTH = 350;
const BTN_DEFAULT = 52;
const BTN_COMPACT = 48;
const LEAVE_DEFAULT = 56;
const LEAVE_COMPACT = 52;

type Props = {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onViewProfile: () => void;
  /** In-call safety report (`submit_user_report`). Omit when not in active call. */
  onSafety?: () => void;
};

export function VideoDateControls({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
  onSafety,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { width: viewportWidth } = useWindowDimensions();
  const isCompactDock = viewportWidth < COMPACT_DOCK_WIDTH;
  const buttonSize = isCompactDock ? BTN_COMPACT : BTN_DEFAULT;
  const leaveSize = isCompactDock ? LEAVE_COMPACT : LEAVE_DEFAULT;
  const iconSize = isCompactDock ? 21 : 22;
  const shieldIconSize = isCompactDock ? 23 : 24;
  const leaveIconSize = isCompactDock ? 25 : 26;
  const quietButtonSize = { width: buttonSize, height: buttonSize };
  const leaveButtonSize = { width: leaveSize, height: leaveSize, borderRadius: leaveSize / 2 };
  const iconOn = theme.text;

  const profileBlock = (
    <Pressable
      onPress={onViewProfile}
      style={({ pressed }) => [styles.profileCluster, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="View profile"
    >
      <View
        style={[
          styles.iconBtn,
          styles.quietBtn,
          quietButtonSize,
          { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: theme.glassBorder },
        ]}
      >
        <Ionicons name="person" size={iconSize} color={iconOn} />
      </View>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.bar,
        isCompactDock && styles.barCompact,
        { backgroundColor: 'rgba(0,0,0,0.46)', borderColor: theme.glassBorder },
      ]}
    >
      <View style={[styles.sideSlot, styles.sideLeft]}>{profileBlock}</View>

      <View style={[styles.centerRail, isCompactDock && styles.centerRailCompact]}>
        <Pressable
          onPress={onToggleMute}
          style={({ pressed }) => [
            styles.iconBtn,
            styles.quietBtn,
            quietButtonSize,
            {
              backgroundColor: isMuted ? theme.dangerSoft : 'rgba(255,255,255,0.07)',
              borderColor: theme.glassBorder,
            },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={iconSize} color={isMuted ? theme.danger : iconOn} />
        </Pressable>

        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.leaveBtn, leaveButtonSize, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="End call"
        >
          <MaterialCommunityIcons name="phone-hangup" size={leaveIconSize} color="#fff" />
        </Pressable>

        <Pressable
          onPress={onToggleVideo}
          style={({ pressed }) => [
            styles.iconBtn,
            styles.quietBtn,
            quietButtonSize,
            {
              backgroundColor: isVideoOff ? theme.dangerSoft : 'rgba(255,255,255,0.07)',
              borderColor: theme.glassBorder,
            },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
        >
          <Ionicons name={isVideoOff ? 'videocam-off' : 'videocam'} size={iconSize} color={isVideoOff ? theme.danger : iconOn} />
        </Pressable>
      </View>

      <View style={[styles.sideSlot, styles.sideRight]}>
        {onSafety ? (
          <Pressable
            onPress={onSafety}
            style={({ pressed }) => [
              styles.iconBtn,
              styles.quietBtn,
              quietButtonSize,
              { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: theme.glassBorder },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Safety and report"
          >
            <Ionicons name="shield-checkmark" size={shieldIconSize} color={theme.tint} />
          </Pressable>
        ) : (
          <View style={quietButtonSize} accessibilityElementsHidden />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: 32,
    minHeight: BTN_DEFAULT + spacing.md * 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.38,
    shadowRadius: 30,
    elevation: 9,
  },
  barCompact: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 28,
    minHeight: BTN_COMPACT + spacing.sm * 2,
  },
  sideSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  sideLeft: { justifyContent: 'flex-start' },
  sideRight: { justifyContent: 'flex-end' },
  centerRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  centerRailCompact: {
    gap: spacing.xs,
    paddingHorizontal: 0,
  },
  profileCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    flexShrink: 1,
  },
  iconBtn: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietBtn: {
    borderWidth: 1,
  },
  leaveBtn: {
    width: LEAVE_DEFAULT,
    height: LEAVE_DEFAULT,
    borderRadius: LEAVE_DEFAULT / 2,
    backgroundColor: 'hsl(0, 84%, 56%)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f87171',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  pressed: {
    opacity: 0.88,
  },
});
