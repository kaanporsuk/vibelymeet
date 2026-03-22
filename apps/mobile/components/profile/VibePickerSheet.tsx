/**
 * Profile Studio vibe editor — web parity: Choose Your Vibes, Energy + Social Style only
 * (see `src/pages/ProfileStudio.tsx` + web `VibeTagSelector` filtered categories).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { updateMyProfile } from '@/lib/profileApi';
import {
  PROFILE_VIBE_CATEGORIES,
  PROFILE_VIBE_LABELS,
} from '@/lib/vibeTagTaxonomy';

const MAX = 5;

export type VibePickerSheetProps = {
  visible: boolean;
  onClose: () => void;
  currentVibes: string[];
  onSave?: () => void;
};

export function VibePickerSheet({ visible, onClose, currentVibes, onSave }: VibePickerSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    const allowed = new Set(PROFILE_VIBE_LABELS);
    const next = (currentVibes ?? []).filter((v) => allowed.has(v));
    setSelected(next.slice(0, MAX));
  }, [visible, currentVibes]);

  const energyOptions = useMemo(
    () => PROFILE_VIBE_CATEGORIES[0].options.map((o) => o.label),
    []
  );
  const socialOptions = useMemo(
    () => PROFILE_VIBE_CATEGORIES[1].options.map((o) => o.label),
    []
  );

  const hasEnergy = selected.some((v) => energyOptions.includes(v));
  const hasSocial = selected.some((v) => socialOptions.includes(v));
  const isValid = selected.length === MAX && hasEnergy && hasSocial;

  const toggle = useCallback(
    (label: string) => {
      setSelected((prev) => {
        if (prev.includes(label)) return prev.filter((x) => x !== label);
        if (prev.length >= MAX) return prev;
        return [...prev, label];
      });
    },
    []
  );

  const handleSave = async () => {
    if (!isValid) return;
    await updateMyProfile({ vibes: selected });
    await qc.invalidateQueries({ queryKey: ['my-profile'] });
    onSave?.();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 20),
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <Text style={[styles.title, { color: theme.text }]}>Choose Your Vibes</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Pick 5 that best describe how you connect.
            </Text>

            <View style={styles.ruleRow}>
              <Text style={[styles.ruleText, { color: theme.textSecondary }]}>
                Pick 5 vibes — at least 1 Energy + 1 Social Style
              </Text>
              <Text style={[styles.counter, { color: selected.length === MAX ? '#E84393' : theme.textSecondary }]}>
                {selected.length}/{MAX}
              </Text>
            </View>

            {PROFILE_VIBE_CATEGORIES.map((cat) => (
              <View key={cat.key} style={styles.categoryBlock}>
                <Text style={[styles.catTitle, { color: theme.text }]}>{cat.title}</Text>
                <Text style={[styles.catSub, { color: theme.textSecondary }]}>{cat.subtitle}</Text>
                <View style={styles.chipGrid}>
                  {cat.options.map((opt) => {
                    const isSelected = selected.includes(opt.label);
                    const atMax = selected.length >= MAX;
                    const disabled = !isSelected && atMax;
                    return (
                      <Pressable
                        key={opt.label}
                        onPress={() => toggle(opt.label)}
                        disabled={disabled}
                        style={({ pressed }) => [
                          styles.chip,
                          isSelected
                            ? {
                                borderColor: '#8B5CF6',
                                backgroundColor: 'rgba(139,92,246,0.15)',
                              }
                            : {
                                backgroundColor: 'rgba(255,255,255,0.06)',
                                borderColor: 'rgba(255,255,255,0.1)',
                              },
                          disabled && { opacity: 0.4 },
                          pressed && !disabled && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.chipEmoji}>{opt.emoji}</Text>
                        <Text style={[styles.chipLabel, { color: theme.text }]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <Pressable
              onPress={handleSave}
              disabled={!isValid}
              style={[styles.saveWrap, { opacity: !isValid ? 0.4 : 1 }]}
            >
              <LinearGradient
                colors={['#8B5CF6', '#E84393']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveGradient}
              >
                <Text style={styles.saveText}>Save Vibes</Text>
              </LinearGradient>
            </Pressable>

            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
    marginTop: 10,
    marginBottom: 12,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  ruleText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.body,
    lineHeight: 18,
  },
  counter: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  categoryBlock: {
    marginBottom: 20,
  },
  catTitle: {
    fontSize: 16,
    fontFamily: fonts.bodyBold,
  },
  catSub: {
    fontSize: 12,
    fontFamily: fonts.body,
    marginTop: 4,
    marginBottom: 12,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '100%',
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipLabel: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  saveWrap: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
  },
  saveGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodyBold,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  cancelText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
});

export default VibePickerSheet;
