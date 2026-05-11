import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { fonts, radius, spacing } from '@/constants/theme';

const TIME_BLOCK_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

const BLOCK_ORDER: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  night: 3,
};

function dayLabel(slotDate: string): string {
  try {
    return format(new Date(`${slotDate}T00:00:00`), 'EEE MMM d');
  } catch {
    return slotDate;
  }
}

export type OfferedBlock = {
  slot_key: string;
  slot_date: string;
  time_block: string;
  mutual?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  offeredBlocks: OfferedBlock[];
  isLoading?: boolean;
  isError?: boolean;
  partnerName: string;
  onContinue: (slotKey: string) => void;
};

export function ChooseSharedBlockSheet({
  visible,
  onClose,
  offeredBlocks,
  isLoading = false,
  isError = false,
  partnerName,
  onContinue,
}: Props) {
  const theme = Colors[useColorScheme()];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (offeredBlocks.length === 1) {
      setSelectedKey(offeredBlocks[0].slot_key);
    } else {
      setSelectedKey(null);
    }
  }, [visible, offeredBlocks]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, OfferedBlock[]>();
    for (const slot of offeredBlocks) {
      const arr = byDay.get(slot.slot_date) ?? [];
      arr.push(slot);
      byDay.set(slot.slot_date, arr);
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => (BLOCK_ORDER[a.time_block] ?? 9) - (BLOCK_ORDER[b.time_block] ?? 9));
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [offeredBlocks]);

  const handleContinue = () => {
    if (!selectedKey) return;
    onContinue(selectedKey);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerLeft}>
              <View style={styles.iconWrap}>
                <Ionicons name="calendar-outline" size={20} color="#22d3ee" />
              </View>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: theme.text }]}>Choose a shared block</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  Pick one of the blocks {partnerName} shared.
                </Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.tint} />
                <Text style={[styles.mutedText, { color: theme.textSecondary }]}>Loading shared blocks...</Text>
              </View>
            ) : isError || grouped.length === 0 ? (
              <View style={[styles.emptyBox, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
                <Text style={[styles.mutedText, { color: theme.textSecondary }]}>
                  {isError
                    ? 'Schedule access expired - ask them to share again.'
                    : `${partnerName} doesn't have any visible open blocks right now.`}
                </Text>
              </View>
            ) : (
              <View style={styles.days}>
                {grouped.map(([day, slots]) => (
                  <View key={day} style={styles.dayGroup}>
                    <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>{dayLabel(day)}</Text>
                    <View style={styles.chipRow}>
                      {slots.map((slot) => {
                        const isSelected = slot.slot_key === selectedKey;
                        return (
                          <Pressable
                            key={slot.slot_key}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setSelectedKey(slot.slot_key)}
                            style={({ pressed }) => [
                              styles.chip,
                              {
                                borderColor: isSelected
                                  ? theme.tint
                                  : slot.mutual
                                    ? 'rgba(245,158,11,0.6)'
                                    : 'rgba(34,211,238,0.5)',
                                backgroundColor: isSelected
                                  ? 'rgba(139,92,246,0.18)'
                                  : slot.mutual
                                    ? 'rgba(245,158,11,0.15)'
                                    : 'rgba(34,211,238,0.1)',
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: isSelected ? theme.tint : slot.mutual ? '#b45309' : '#0e7490',
                                },
                              ]}
                            >
                              {TIME_BLOCK_LABEL[slot.time_block] ?? slot.time_block}
                              {slot.mutual ? ' - Both open' : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Pressable
              accessibilityRole="button"
              disabled={!selectedKey || isLoading || isError}
              accessibilityState={{ disabled: !selectedKey || isLoading || isError }}
              onPress={handleContinue}
              style={[
                styles.continueBtn,
                { backgroundColor: theme.tint, opacity: !selectedKey || isLoading || isError ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.continueText, { color: theme.primaryForeground }]}>Continue</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: '80%',
  },
  header: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerText: { flex: 1 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.15)',
  },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  closeBtn: { padding: spacing.xs },
  content: { padding: spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mutedText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  emptyBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  days: { gap: spacing.md },
  dayGroup: { gap: spacing.xs },
  dayLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 12 },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  continueBtn: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  continueText: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
});
