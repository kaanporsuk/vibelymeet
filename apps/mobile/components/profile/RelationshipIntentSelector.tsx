/**
 * Relationship intent — web parity (src/components/RelationshipIntent.tsx).
 * Values stored in profile.looking_for.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';

/** Same ids + labels + emoji as web `intentOptions` (+ `rather-not` for legacy rows). */
export const RELATIONSHIP_INTENT_OPTIONS: {
  id: string;
  label: string;
  emoji: string;
  description?: string;
}[] = [
  { id: 'long-term', label: 'Long-term partner', emoji: '💍', description: 'Ready to settle down' },
  { id: 'relationship', label: 'Relationship', emoji: '💕', description: 'Open to something real' },
  { id: 'something-casual', label: 'Something casual', emoji: '✨', description: "Let's see where it goes" },
  { id: 'new-friends', label: 'New friends', emoji: '👋', description: 'Expanding the squad' },
  { id: 'figuring-out', label: 'Figuring it out', emoji: '🤷', description: 'Still exploring' },
  { id: 'rather-not', label: 'Rather not say', emoji: '🤐' },
];

export function getLookingForDisplay(
  id: string | null | undefined
): { label: string; emoji: string } | null {
  if (!id) return null;
  const opt = RELATIONSHIP_INTENT_OPTIONS.find((o) => o.id === id);
  return opt ? { label: opt.label, emoji: opt.emoji } : { label: id, emoji: '💫' };
}

type RelationshipIntentSelectorProps = {
  selected: string;
  onSelect: (id: string) => void;
  editable?: boolean;
};

export function RelationshipIntentSelector({ selected, onSelect, editable = true }: RelationshipIntentSelectorProps) {
  const theme = Colors[useColorScheme()];

  if (!editable) {
    const display = getLookingForDisplay(selected);
    if (!display) return null;
    return (
      <View
        style={[styles.displayChip, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}
      >
        <Text style={styles.displayEmoji}>{display.emoji}</Text>
        <VibelyText variant="body" style={{ color: theme.text, fontWeight: '600' }}>
          {display.label}
        </VibelyText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {RELATIONSHIP_INTENT_OPTIONS.map((opt) => {
        const isSelected = selected === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            style={[
              styles.optionRow,
              {
                backgroundColor: isSelected ? theme.tintSoft : theme.surfaceSubtle,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? theme.tint : theme.border,
              },
            ]}
          >
            <Text style={styles.optionEmoji}>{opt.emoji}</Text>
            <View style={styles.optionTextWrap}>
              <VibelyText variant="body" style={{ color: theme.text, fontWeight: '600' }}>
                {opt.label}
              </VibelyText>
              {opt.description ? (
                <VibelyText variant="caption" style={{ color: theme.textSecondary }}>
                  {opt.description}
                </VibelyText>
              ) : null}
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color={theme.tint} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  displayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  displayEmoji: { fontSize: 18 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xl,
  },
  optionEmoji: { fontSize: 22 },
  optionTextWrap: { flex: 1, gap: 2 },
});
