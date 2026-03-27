/**
 * Branded entry for Vibe Clip capture — replaces plain Alert for record vs library.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import {
  VIBE_CLIP_LIBRARY,
  VIBE_CLIP_LIBRARY_HINT,
  VIBE_CLIP_RECORD_PRIMARY,
  VIBE_CLIP_RECORD_SECONDARY,
  VIBE_CLIP_SHEET_SUBTITLE,
  VIBE_CLIP_SHEET_TITLE,
} from '../../../../shared/chat/vibeClipCaptureCopy';
import { capturePromptForSeed } from '../../../../shared/chat/vibeClipPrompts';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRecord: () => void;
  onChooseLibrary: () => void;
  disabled?: boolean;
  /** Stabilizes rotating capture ideas (e.g. match id). */
  promptSeed?: string;
};

const ACCENT = 'rgba(139,92,246,1)';
const ACCENT_DIM = 'rgba(139,92,246,0.14)';

export function VibeClipSendOptionsSheet({
  visible,
  onClose,
  onRecord,
  onChooseLibrary,
  disabled,
  promptSeed,
}: Props) {
  const theme = Colors[useColorScheme()];
  const [captureSpark, setCaptureSpark] = useState('');

  useEffect(() => {
    if (!visible) return;
    setCaptureSpark(capturePromptForSeed(`${promptSeed ?? 'vibe'}|${Date.now()}`));
  }, [visible, promptSeed]);

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      backdropColor="rgba(0,0,0,0.85)"
      showHandle
      handleStyle={{ width: 100, height: 8, borderRadius: 999, marginTop: 16, marginBottom: 12 }}
      scrollable={false}
    >
      <View style={styles.inner}>
        <View style={[styles.brandPill, { borderColor: 'rgba(139,92,246,0.35)', backgroundColor: ACCENT_DIM }]}>
          <Ionicons name="film-outline" size={14} color={ACCENT} />
          <Text style={[styles.brandPillText, { color: ACCENT }]}>Vibe Clip</Text>
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{VIBE_CLIP_SHEET_TITLE}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{VIBE_CLIP_SHEET_SUBTITLE}</Text>
        {captureSpark ? (
          <Text style={[styles.sparkLine, { color: theme.textSecondary }]} accessibilityRole="text">
            {captureSpark}
          </Text>
        ) : null}

        <Pressable
          disabled={disabled}
          onPress={() => {
            if (!disabled) onRecord();
          }}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: disabled ? theme.muted : ACCENT,
              opacity: pressed && !disabled ? 0.92 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${VIBE_CLIP_RECORD_PRIMARY}. ${VIBE_CLIP_RECORD_SECONDARY}`}
        >
          <Ionicons name="videocam-outline" size={22} color="#fff" />
          <View style={styles.primaryTextCol}>
            <Text style={styles.primaryLabel}>{VIBE_CLIP_RECORD_PRIMARY}</Text>
            <Text style={styles.primaryHint}>{VIBE_CLIP_RECORD_SECONDARY}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>

        <Pressable
          disabled={disabled}
          onPress={() => {
            if (!disabled) onChooseLibrary();
          }}
          style={({ pressed }) => [
            styles.secondaryBtn,
            {
              borderColor: theme.border,
              backgroundColor: theme.surface,
              opacity: pressed && !disabled ? 0.9 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${VIBE_CLIP_LIBRARY}. ${VIBE_CLIP_LIBRARY_HINT}`}
        >
          <Ionicons name="images-outline" size={20} color={theme.textSecondary} />
          <View style={styles.secondaryTextCol}>
            <Text style={[styles.secondaryLabel, { color: theme.text }]}>{VIBE_CLIP_LIBRARY}</Text>
            <Text style={[styles.secondaryHint, { color: theme.textSecondary }]}>{VIBE_CLIP_LIBRARY_HINT}</Text>
          </View>
        </Pressable>

        <Pressable onPress={onClose} style={styles.cancelBtn} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Not now</Text>
        </Pressable>
      </View>
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  inner: {
    paddingBottom: spacing.xl,
  },
  brandPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  brandPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  sparkLine: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.lg,
    opacity: 0.92,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  primaryTextCol: {
    flex: 1,
    gap: 2,
  },
  primaryLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  primaryHint: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.88)',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryTextCol: {
    flex: 1,
    gap: 2,
  },
  secondaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
