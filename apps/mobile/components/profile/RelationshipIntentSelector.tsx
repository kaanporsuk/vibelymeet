/**
 * Relationship intent options — web parity (RelationshipIntent.tsx).
 * Values stored in profile.looking_for.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';

export const RELATIONSHIP_INTENT_OPTIONS: { id: string; label: string }[] = [
  { id: 'long-term', label: 'Something serious' },
  { id: 'something-casual', label: 'Something casual' },
  { id: 'figuring-out', label: 'Not sure yet' },
  { id: 'new-friends', label: 'New friends' },
  { id: 'rather-not', label: 'Rather not say' },
];

type RelationshipIntentSelectorProps = {
  selected: string;
  onSelect: (id: string) => void;
  editable?: boolean;
};

export function RelationshipIntentSelector({ selected, onSelect, editable = true }: RelationshipIntentSelectorProps) {
  const theme = Colors[useColorScheme()];

  if (!editable) {
    const opt = RELATIONSHIP_INTENT_OPTIONS.find((o) => o.id === selected);
    if (!opt) return null;
    return (
      <View style={[styles.chip, { backgroundColor: theme.tintSoft }]}>
        <VibelyText variant="body" style={{ color: theme.tint }}>{opt.label}</VibelyText>
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
              styles.chip,
              { backgroundColor: isSelected ? theme.tintSoft : theme.surfaceSubtle, borderWidth: 1, borderColor: isSelected ? theme.tint : theme.border },
            ]}
          >
            <VibelyText variant="body" style={{ color: isSelected ? theme.tint : theme.text }}>{opt.label}</VibelyText>
            {isSelected && <Ionicons name="checkmark-circle" size={18} color={theme.tint} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg },
});
