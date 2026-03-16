/**
 * Emoji reaction picker (❤️ 🔥 🤣 😮 👎). Shown on long-press on message.
 * Reference: src/components/chat/EmojiBar.tsx
 */
import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { ReactionEmoji } from '@/lib/chatApi';

const EMOJIS: { emoji: ReactionEmoji; label: string }[] = [
  { emoji: '❤️', label: 'Love' },
  { emoji: '🔥', label: 'Hot' },
  { emoji: '🤣', label: 'Laugh' },
  { emoji: '😮', label: 'Shock' },
  { emoji: '👎', label: 'Nope' },
];

type ReactionPickerProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: ReactionEmoji) => void;
  anchorRight?: boolean;
};

export function ReactionPicker({ visible, onClose, onSelect, anchorRight = false }: ReactionPickerProps) {
  const theme = Colors[useColorScheme()];

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.bar, { backgroundColor: theme.surface }, anchorRight ? styles.barRight : styles.barLeft]}
          onPress={(e) => e.stopPropagation()}
        >
          {EMOJIS.map(({ emoji, label }) => (
            <Pressable
              key={emoji}
              onPress={() => {
                onSelect(emoji);
                onClose();
              }}
              style={({ pressed }) => [styles.emojiBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', paddingBottom: 120 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
  },
  barLeft: { alignSelf: 'flex-start', marginLeft: spacing.lg + 40 },
  barRight: { alignSelf: 'flex-end', marginRight: spacing.lg + 40 },
  emojiBtn: { padding: 8 },
  emoji: { fontSize: 24 },
});
