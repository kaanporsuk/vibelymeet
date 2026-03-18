/**
 * Match actions sheet — Unmatch, Archive, Block, Mute, Report. Shown from match row or chat.
 */
import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';

export type MatchAction = 'unmatch' | 'archive' | 'block' | 'mute' | 'report';

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
  onMute: () => void;
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

  if (!visible) return null;

  const row = (icon: string, label: string, onPress: () => void, destructive?: boolean) => (
    <Pressable
      key={label}
      onPress={() => { onPress(); onClose(); }}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
      disabled={!!loading}
    >
      <Ionicons name={icon as any} size={22} color={destructive ? theme.danger : theme.text} />
      <Text style={[styles.rowLabel, { color: destructive ? theme.danger : theme.text }]}>{label}</Text>
      {loading ? <ActivityIndicator size="small" color={theme.tint} /> : null}
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{matchName}</Text>
          {onViewProfile ? row('person-outline', 'View Profile', onViewProfile) : null}
          {row('archive-outline', isArchived ? 'Unarchive' : 'Archive', isArchived ? onUnarchive : onArchive)}
          {row('notifications-off-outline', isMuted ? 'Unmute notifications' : 'Mute notifications', isMuted ? onUnmute : onMute)}
          {row('flag-outline', 'Report', onReport)}
          {row('ban-outline', 'Block', onBlock, true)}
          {row('person-remove-outline', 'Unmatch', onUnmatch, true)}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 16, flex: 1 },
});
