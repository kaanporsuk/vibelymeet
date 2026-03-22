/**
 * Tagline editor — local draft state + delayed focus after modal animation
 * to avoid keyboard/sheet flicker (parent ProfileStudio must not re-render per keystroke).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View as RNView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';

const TAGLINE_MAX = 60;
const FOCUS_DELAY_MS = 400;

export type TaglineEditorSheetProps = {
  visible: boolean;
  initialTagline: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (tagline: string) => Promise<void>;
};

export function TaglineEditorSheet({
  visible,
  initialTagline,
  saving = false,
  onClose,
  onSave,
}: TaglineEditorSheetProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const inputRef = useRef<TextInput>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);

  const [draft, setDraft] = useState(() => initialTagline ?? '');

  // Reset draft only when the sheet opens (not on parent re-renders / profile refetch while open).
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setDraft(initialTagline ?? '');
    }
    wasVisibleRef.current = visible;
  }, [visible, initialTagline]);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const clearFocusTimer = useCallback(() => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  const handleModalShow = useCallback(() => {
    clearFocusTimer();
    focusTimerRef.current = setTimeout(() => {
      inputRef.current?.focus();
      focusTimerRef.current = null;
    }, FOCUS_DELAY_MS);
  }, [clearFocusTimer]);

  const handleRequestClose = useCallback(() => {
    clearFocusTimer();
    inputRef.current?.blur();
    onClose();
  }, [clearFocusTimer, onClose]);

  const handleSave = useCallback(async () => {
    clearFocusTimer();
    inputRef.current?.blur();
    await onSave(draft);
  }, [clearFocusTimer, draft, onSave]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleModalShow}
      onRequestClose={handleRequestClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={handleRequestClose}>
        <Pressable style={[styles.sheetContent, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Your Tagline</Text>
          <Text style={[styles.sheetSubtitle, { color: theme.textSecondary }]}>
            A short line that appears under your name
          </Text>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, TAGLINE_MAX))}
            placeholder="e.g. Founder of Vibely!"
            placeholderTextColor={theme.mutedForeground}
            style={[styles.taglineInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.text }]}
            maxLength={TAGLINE_MAX}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => inputRef.current?.blur()}
          />
          <Text style={[styles.charCount, { color: theme.mutedForeground }]}>
            {draft.length}/{TAGLINE_MAX}
          </Text>
          <RNView style={styles.sheetFooter}>
            <Pressable onPress={handleSave} style={[styles.sheetSaveBtn, { opacity: saving ? 0.6 : 1 }]} disabled={saving}>
              <LinearGradient colors={['#8B5CF6', '#E84393']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} />
              <Text style={styles.sheetSaveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable onPress={handleRequestClose} style={styles.sheetCancel}>
              <Text style={[styles.sheetCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
          </RNView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing.lg,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  taglineInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    fontFamily: fonts.body,
    marginTop: spacing.sm,
  },
  charCount: {
    fontSize: 12,
    fontFamily: fonts.body,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  sheetFooter: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sheetSaveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheetSaveBtnText: {
    color: '#fff',
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  sheetCancelText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
});
