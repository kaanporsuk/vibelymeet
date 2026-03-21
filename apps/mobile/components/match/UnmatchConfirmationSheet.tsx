/**
 * Confirmation before undoable unmatch (matches swipe-left flow).
 */
import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';

export type UnmatchConfirmationSheetProps = {
  visible: boolean;
  onClose: () => void;
  name: string;
  imageUri: string;
  onConfirmUnmatch: () => void;
  onReportInstead: () => void;
};

export function UnmatchConfirmationSheet({
  visible,
  onClose,
  name,
  imageUri,
  onConfirmUnmatch,
  onReportInstead,
}: UnmatchConfirmationSheetProps) {
  const theme = Colors[useColorScheme()];

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <View style={styles.headerRow}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: theme.muted }]}>
                <Text style={[styles.avatarLetter, { color: theme.textSecondary }]}>{name?.[0] ?? '?'}</Text>
              </View>
            )}
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
              Unmatch with {name}?
            </Text>
          </View>
          <Text style={[styles.warning, { color: theme.textSecondary }]}>
            This is permanent. Your conversation history will be deleted.
          </Text>
          <Pressable
            onPress={() => {
              onConfirmUnmatch();
              onClose();
            }}
            style={({ pressed }) => [styles.primaryDestructive, pressed && { opacity: 0.9 }]}
          >
            <Ionicons name="heart-dislike-outline" size={20} color="#fff" />
            <Text style={styles.primaryDestructiveText}>Unmatch</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Keep Match</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onReportInstead();
              onClose();
            }}
            style={({ pressed }) => [styles.tertiary, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.tertiaryText, { color: theme.tint }]}>
              Report {name} instead
            </Text>
          </Pressable>
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
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 22, fontWeight: '700' },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  warning: { fontSize: 15, lineHeight: 22, marginBottom: spacing.lg },
  primaryDestructive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  primaryDestructiveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  tertiary: { alignSelf: 'center', paddingVertical: spacing.sm },
  tertiaryText: { fontSize: 15, fontWeight: '600' },
});
