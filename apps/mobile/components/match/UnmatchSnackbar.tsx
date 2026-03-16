/**
 * Snackbar shown after user confirms unmatch: "Unmatched" + Undo for 5 seconds.
 * Reference: web useUndoableUnmatch toast.
 */

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';

type UnmatchSnackbarProps = {
  visible: boolean;
  name: string;
  onUndo: () => void;
};

export function UnmatchSnackbar({ visible, name, onUndo }: UnmatchSnackbarProps) {
  const theme = Colors[useColorScheme()];

  if (!visible) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.message, { color: theme.text }]} numberOfLines={1}>
        Unmatched with {name}
      </Text>
      <Pressable onPress={onUndo} style={({ pressed }) => [styles.undoBtn, { backgroundColor: theme.tint }, pressed && { opacity: 0.8 }]}>
        <Text style={styles.undoText}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: spacing.xl + 60,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  message: { flex: 1, fontSize: 14 },
  undoBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.md },
  undoText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
