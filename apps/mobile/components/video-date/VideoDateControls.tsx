/**
 * Bottom dock: Profile (+ partner name), Mic, Leave (center), Camera, Safety.
 * Icon-only; Leave uses destructive styling. Optional +Time is surfaced by the screen (not in this row).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const BTN = 52;
const LEAVE = 56;

type Props = {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onViewProfile: () => void;
  /** Partner display name — shown beside the profile control only (not a separate floating chip). */
  partnerName?: string | null;
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
  partnerName,
  onSafety,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const iconOn = theme.text;
  const leaveRotation = '135deg' as const;

  const profileBlock = (
    <Pressable
      onPress={onViewProfile}
      style={({ pressed }) => [styles.profileCluster, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={partnerName ? `View ${partnerName}'s profile` : 'View profile'}
    >
      <View style={[styles.iconBtn, { width: BTN, height: BTN, backgroundColor: theme.muted }]}>
        <Ionicons name="person" size={22} color={iconOn} />
      </View>
      {partnerName ? (
        <Text style={[styles.partnerName, { color: theme.text }]} numberOfLines={1}>
          {partnerName}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <View style={[styles.bar, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
      <View style={[styles.sideSlot, styles.sideLeft]}>{profileBlock}</View>

      <View style={styles.centerRail}>
        <Pressable
          onPress={onToggleMute}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: BTN, height: BTN, backgroundColor: isMuted ? theme.dangerSoft : theme.muted },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? theme.danger : iconOn} />
        </Pressable>

        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.leaveBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="End call"
        >
          <View style={[styles.leaveInner, { transform: [{ rotate: leaveRotation }] }]}>
            <Ionicons name="call" size={26} color="#fff" />
          </View>
        </Pressable>

        <Pressable
          onPress={onToggleVideo}
          style={({ pressed }) => [
            styles.iconBtn,
            { width: BTN, height: BTN, backgroundColor: isVideoOff ? theme.dangerSoft : theme.muted },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
        >
          <Ionicons name={isVideoOff ? 'videocam-off' : 'videocam'} size={22} color={isVideoOff ? theme.danger : iconOn} />
        </Pressable>
      </View>

      <View style={[styles.sideSlot, styles.sideRight]}>
        {onSafety ? (
          <Pressable
            onPress={onSafety}
            style={({ pressed }) => [
              styles.iconBtn,
              { width: BTN, height: BTN, backgroundColor: theme.muted },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Safety and report"
          >
            <Ionicons name="shield-checkmark" size={24} color={theme.tint} />
          </Pressable>
        ) : (
          <View style={{ width: BTN, height: BTN }} accessibilityElementsHidden />
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    minHeight: BTN + spacing.md * 2,
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
  profileCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    flexShrink: 1,
  },
  partnerName: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  iconBtn: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveBtn: {
    width: LEAVE,
    height: LEAVE,
    borderRadius: LEAVE / 2,
    backgroundColor: 'hsl(0, 84%, 56%)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f87171',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  leaveInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.88,
  },
});
