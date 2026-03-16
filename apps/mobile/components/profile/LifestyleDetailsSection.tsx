/**
 * Lifestyle preferences — drinking, smoking, exercise, diet, pets. Stored in profile.lifestyle JSONB.
 * Reference: src/components/LifestyleDetails.tsx; user-specified options.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';

export const LIFESTYLE_CATEGORIES: { id: string; label: string; options: { value: string; label: string }[] }[] = [
  { id: 'drinking', label: 'Drinking', options: [{ value: 'never', label: 'Never' }, { value: 'socially', label: 'Socially' }, { value: 'regularly', label: 'Regularly' }] },
  { id: 'smoking', label: 'Smoking', options: [{ value: 'never', label: 'Never' }, { value: 'socially', label: 'Socially' }, { value: 'regularly', label: 'Regularly' }] },
  { id: 'exercise', label: 'Exercise', options: [{ value: 'never', label: 'Never' }, { value: 'sometimes', label: 'Sometimes' }, { value: 'often', label: 'Often' }, { value: 'daily', label: 'Daily' }] },
  { id: 'diet', label: 'Diet', options: [{ value: 'no-preference', label: 'No preference' }, { value: 'vegetarian', label: 'Vegetarian' }, { value: 'vegan', label: 'Vegan' }, { value: 'halal', label: 'Halal' }, { value: 'kosher', label: 'Kosher' }, { value: 'other', label: 'Other' }] },
  { id: 'pets', label: 'Pets', options: [{ value: 'dog', label: 'Dog lover' }, { value: 'cat', label: 'Cat lover' }, { value: 'both', label: 'Both' }, { value: 'none', label: 'No pets' }, { value: 'other', label: 'Other' }] },
];

type LifestyleDetailsSectionProps = {
  values: Record<string, string>;
  onChange?: (key: string, value: string) => void;
  editable?: boolean;
};

export function LifestyleDetailsSection({ values, onChange = () => {}, editable = true }: LifestyleDetailsSectionProps) {
  const theme = Colors[useColorScheme()];

  if (!editable) {
    const filled = LIFESTYLE_CATEGORIES.filter((c) => values[c.id]);
    if (filled.length === 0) return null;
    return (
      <View style={styles.wrap}>
        {filled.map((cat) => {
          const opt = cat.options.find((o) => o.value === values[cat.id]);
          if (!opt) return null;
          return (
            <View key={cat.id} style={[styles.displayChip, { backgroundColor: theme.surfaceSubtle }]}>
              <VibelyText variant="caption" style={{ color: theme.textSecondary }}>{cat.label}: </VibelyText>
              <VibelyText variant="body" style={{ color: theme.text }}>{opt.label}</VibelyText>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {LIFESTYLE_CATEGORIES.map((cat) => (
        <View key={cat.id} style={styles.category}>
          <View style={styles.categoryHeader}>
            <Ionicons name="ellipse" size={6} color={theme.tint} />
            <VibelyText variant="overline" style={[styles.categoryLabel, { color: theme.textSecondary }]}>{cat.label}</VibelyText>
          </View>
          <View style={styles.optionsRow}>
            {cat.options.map((opt) => {
              const isSelected = values[cat.id] === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => onChange(cat.id, opt.value)}
                  style={[styles.optionChip, { backgroundColor: isSelected ? theme.tintSoft : theme.surfaceSubtle, borderColor: isSelected ? theme.tint : theme.border }]}
                >
                  <VibelyText variant="caption" style={{ color: isSelected ? theme.tint : theme.text }}>{opt.label}</VibelyText>
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
  category: { gap: spacing.xs },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryLabel: {},
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 },
  optionChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1 },
  displayChip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.md, marginRight: spacing.xs, marginBottom: spacing.xs, alignSelf: 'flex-start' },
});
