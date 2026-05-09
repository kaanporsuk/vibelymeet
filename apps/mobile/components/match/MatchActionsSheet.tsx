/**
 * Match actions sheet — Unmatch, Archive, Block, Mute, Report. Shown from match row or chat.
 */
import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import {
  MATCH_MUTE_DURATIONS,
  getMatchMuteDurationDescription,
  getMatchMuteDurationOptionLabel,
  type MatchMuteDuration,
} from '@clientShared/chat/matchMuteDurations';

export type MatchAction = 'unmatch' | 'archive' | 'block' | 'mute' | 'report';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type MatchActionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  matchName: string;
  isArchived?: boolean;
  isMuted?: boolean;
  onViewProfile?: () => void;
  onUnmatch: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onBlock: () => void;
  onMute: (duration: MatchMuteDuration) => void;
  onUnmute: () => void;
  onReport: () => void;
  loading?: string | null;
};

export function MatchActionsSheet({
  visible,
  onClose,
  matchName,
  isArchived = false,
  isMuted = false,
  onViewProfile,
  onUnmatch,
  onArchive,
  onUnarchive,
  onBlock,
  onMute,
  onUnmute,
  onReport,
  loading = null,
}: MatchActionsSheetProps) {
  const theme = Colors[useColorScheme()];
  const [mode, setMode] = React.useState<'main' | 'mute'>('main');

  React.useEffect(() => {
    if (!visible) setMode('main');
  }, [visible]);

  if (!visible) return null;

  const row = (icon: IoniconName, label: string, onPress: () => void, destructive?: boolean, closeAfterPress = true) => (
    <Pressable
      key={label}
      onPress={() => {
        onPress();
        if (closeAfterPress) onClose();
      }}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
      disabled={!!loading}
    >
      <Ionicons name={icon} size={22} color={destructive ? theme.danger : theme.text} />
      <Text style={[styles.rowLabel, { color: destructive ? theme.danger : theme.text }]}>{label}</Text>
      {loading ? <ActivityIndicator size="small" color={theme.tint} /> : null}
    </Pressable>
  );

  const muteDurationRow = (duration: MatchMuteDuration) => (
    <Pressable
      key={duration}
      onPress={() => { onMute(duration); onClose(); }}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
      disabled={!!loading}
    >
      <Ionicons name={duration === 'forever' ? 'notifications-off-outline' : 'time-outline'} size={22} color={theme.text} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{getMatchMuteDurationOptionLabel(duration)}</Text>
        <Text style={[styles.rowSubLabel, { color: theme.textSecondary }]}>{getMatchMuteDurationDescription(duration)}</Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={theme.tint} /> : null}
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          {mode === 'main' ? (
            <>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{matchName}</Text>
              {onViewProfile ? row('person-outline', 'View Profile', onViewProfile) : null}
              {row('archive-outline', isArchived ? 'Unarchive' : 'Archive', isArchived ? onUnarchive : onArchive)}
              {row(
                isMuted ? 'notifications-outline' : 'notifications-off-outline',
                isMuted ? 'Unmute notifications' : 'Mute notifications',
                isMuted ? onUnmute : () => setMode('mute'),
                false,
                isMuted
              )}
              {row('flag-outline', 'Report', onReport)}
              {row('ban-outline', 'Block', onBlock, true)}
              {row('person-remove-outline', 'Unmatch', onUnmatch, true)}
            </>
          ) : (
            <>
              <View style={styles.subHeader}>
                <Pressable
                  onPress={() => setMode('main')}
                  style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                >
                  <Ionicons name="chevron-back" size={22} color={theme.text} />
                </Pressable>
                <Text style={[styles.title, styles.subTitle, { color: theme.text }]} numberOfLines={1}>
                  Mute notifications
                </Text>
                <View style={styles.backBtn} />
              </View>
              {MATCH_MUTE_DURATIONS.map(muteDurationRow)}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderTopWidth: 1,
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing.lg,
  },
  handle: {
    width: 100,
    height: 8,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  subHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  subTitle: { flex: 1, textAlign: 'center', marginBottom: 0 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, flex: 1 },
  rowSubLabel: { fontSize: 12, marginTop: 2 },
});
