/**
 * Lifestyle preferences — web parity `LifestyleDetails.tsx` (chips display + emoji options when editing).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import { LIFESTYLE_ITEMS, getLifestyleDisplayChips } from '@/lib/lifestyleChips';

/** @deprecated use LIFESTYLE_ITEMS from `@/lib/lifestyleChips` */
export const LIFESTYLE_CATEGORIES = LIFESTYLE_ITEMS;

type LifestyleDetailsSectionProps = {
  values: Record<string, string>;
  onChange?: (key: string, value: string) => void;
  editable?: boolean;
};

export function LifestyleDetailsSection({ values, onChange = () => {}, editable = true }: LifestyleDetailsSectionProps) {
  const theme = Colors[useColorScheme()];

  if (!editable) {
    const chips = getLifestyleDisplayChips(values);
    if (chips.length === 0) return null;
    return (
      <View style={styles.displayWrap}>
        {chips.map((chip) => (
          <View
            key={chip.id}
            style={[styles.displayChip, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          >
            <Text style={styles.displayEmoji}>{chip.emoji}</Text>
            <Text style={[styles.displayLabel, { color: theme.text }]}>{chip.label}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {LIFESTYLE_ITEMS.map((cat) => (
        <View key={cat.id} style={styles.category}>
          <View style={styles.categoryHeader}>
            <Ionicons name="ellipse" size={6} color={theme.tint} />
            <VibelyText variant="overline" style={[styles.categoryLabel, { color: theme.textSecondary }]}>
              {cat.label}
            </VibelyText>
          </View>
          <View style={styles.optionsRow}>
            {cat.options.map((opt) => {
              const isSelected = values[cat.id] === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => onChange(cat.id, opt.value)}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: isSelected ? theme.tintSoft : theme.surfaceSubtle,
                      borderColor: isSelected ? theme.tint : theme.border,
                    },
                  ]}
                >
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                  <VibelyText variant="caption" style={{ color: isSelected ? theme.tint : theme.text }}>
                    {opt.label}
                  </VibelyText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  displayWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  displayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  displayEmoji: { fontSize: 14 },
  displayLabel: { fontSize: 13, fontWeight: '500' },
  category: { gap: spacing.xs },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryLabel: {},
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  optionEmoji: { fontSize: 14 },
});
