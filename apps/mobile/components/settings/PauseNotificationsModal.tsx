import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import type { PauseKind } from '@/lib/notificationPause';

type Theme = (typeof Colors)[keyof typeof Colors];

const OPTIONS: {
  id: PauseKind;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
}[] = [
  { id: 'm30', icon: 'time-outline', label: '30 minutes', description: 'Quick break' },
  { id: 'h1', icon: 'time-outline', label: '1 hour', description: 'Short pause' },
  { id: 'h8', icon: 'moon-outline', label: '8 hours', description: 'While you sleep' },
  { id: 'd1', icon: 'sunny-outline', label: '24 hours', description: 'Day off' },
  { id: 'w1', icon: 'calendar-outline', label: '1 week', description: 'Extended break' },
  {
    id: 'manual',
    icon: 'infinite-outline',
    label: 'Until I turn it back on',
    description: 'Manual resume only',
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  activePauseKind: PauseKind | null;
  isPaused: boolean;
  busy: boolean;
  onSelectDuration: (kind: PauseKind) => void;
  onResume: () => void;
};

export function PauseNotificationsModal({
  visible,
  onClose,
  theme,
  activePauseKind,
  isPaused,
  busy,
  onSelectDuration,
  onResume,
}: Props) {
  const insets = useSafeAreaInsets();
  const pink = theme.neonPink ?? '#E84393';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: insets.bottom + 32,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.header}>
              <Ionicons name="pause-circle" size={32} color={theme.tint} />
              <Text style={[styles.title, { color: theme.text }]}>Pause Notifications</Text>
              <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
                Notifications will resume automatically
              </Text>
            </View>

            {OPTIONS.map((opt) => {
              const selected = activePauseKind === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  disabled={busy}
                  onPress={() => onSelectDuration(opt.id)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    {
                      borderColor: theme.border,
                      backgroundColor: pressed ? withAlpha(theme.tint, 0.08) : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name={opt.icon} size={22} color={theme.text} style={styles.optionIcon} />
                  <View style={styles.optionTextCol}>
                    <Text style={[styles.optionLabel, { color: theme.text }]}>{opt.label}</Text>
                    <Text style={[styles.optionDesc, { color: theme.mutedForeground }]}>{opt.description}</Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={theme.tint} />
                  ) : (
                    <View style={styles.checkPlaceholder} />
                  )}
                </Pressable>
              );
            })}

            {isPaused ? (
              <>
                <View style={[styles.separator, { backgroundColor: theme.border }]} />
                <Pressable
                  disabled={busy}
                  onPress={onResume}
                  style={({ pressed }) => [
                    styles.resumeRow,
                    {
                      backgroundColor: pressed ? withAlpha(pink, 0.18) : withAlpha(pink, 0.12),
                      borderColor: withAlpha(pink, 0.3),
                    },
                  ]}
                >
                  <Ionicons name="play-circle-outline" size={22} color={pink} style={styles.optionIcon} />
                  <View style={styles.optionTextCol}>
                    <Text style={[styles.resumeLabel, { color: pink }]}>Resume Now</Text>
                    <Text style={[styles.optionDesc, { color: theme.mutedForeground }]}>
                      Turn notifications back on immediately
                    </Text>
                  </View>
                </Pressable>
              </>
            ) : null}

            {busy ? (
              <View style={styles.busyWrap}>
                <ActivityIndicator color={theme.tint} />
              </View>
            ) : null}

            <Pressable onPress={onClose} style={styles.cancelBtn} hitSlop={12}>
              <Text style={[styles.cancelLabel, { color: theme.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '92%',
    paddingHorizontal: 24,
    paddingTop: 0,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  optionIcon: {
    marginRight: 12,
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  optionDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  checkPlaceholder: {
    width: 22,
  },
  separator: {
    height: 1,
    marginVertical: 12,
  },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  resumeLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  busyWrap: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelLabel: {
    fontSize: 15,
    textAlign: 'center',
  },
});
