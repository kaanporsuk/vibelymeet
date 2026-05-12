import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { ScheduleSharePicker } from '@/components/schedule/ScheduleSharePicker';
import { useVibelyDialog } from '@/components/VibelyDialog';
import Colors from '@/constants/Colors';
import { fonts, radius, spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { dateSuggestionApply, DateSuggestionDomainError } from '@/lib/dateSuggestionApply';
import { SCHEDULE_QUERY_KEY } from '@/lib/useSchedule';
import { useAuth } from '@/context/AuthContext';

type ScheduleShareSheetProps = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
  onActiveSuggestionConflict?: (suggestionId: string | null) => void;
  onSent?: (suggestionId: string | null) => void;
};

/**
 * Native + -> Schedule entry point. It mirrors the web mobile schedule share
 * sheet and persists through the existing date suggestion action path.
 */
export function ScheduleShareSheet({
  visible,
  onClose,
  matchId,
  partnerName,
  onActiveSuggestionConflict,
  onSent,
}: ScheduleShareSheetProps) {
  const theme = Colors[useColorScheme()];
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const { show: showDialog, dialog } = useVibelyDialog();

  useEffect(() => {
    if (!visible) {
      setSelectedSlotKeys([]);
      setIsSending(false);
    }
  }, [visible]);

  const handleSelectionChange = useCallback((keys: string[]) => {
    setSelectedSlotKeys(keys);
  }, []);

  const refreshOwnSchedule = useCallback(() => {
    if (!user?.id) return;
    void queryClient.invalidateQueries({ queryKey: SCHEDULE_QUERY_KEY(user.id) });
  }, [queryClient, user?.id]);

  const handleSend = useCallback(async () => {
    if (selectedSlotKeys.length === 0 || isSending) return;

    setIsSending(true);
    try {
      const result = (await dateSuggestionApply('send_proposal', {
        match_id: matchId,
        revision: {
          date_type_key: 'hangout',
          time_choice_key: 'share_schedule',
          place_mode_key: 'decide_together',
          schedule_share_enabled: true,
          selected_slot_keys: selectedSlotKeys,
        },
      })) as { suggestion_id?: string | null } | null;

      onSent?.(result?.suggestion_id ?? null);
      onClose();
    } catch (err) {
      if (err instanceof DateSuggestionDomainError) {
        if (err.code === 'active_suggestion_exists') {
          onActiveSuggestionConflict?.(err.suggestionId);
          onClose();
          return;
        }
        if (err.code === 'tier_capability_disabled') {
          showDialog({
            title: 'Schedule',
            message: 'Schedule sharing is not available on your plan yet.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (err.code === 'selected_slots_required') {
          showDialog({
            title: 'Schedule',
            message: 'Pick at least one open block to share.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (err.code === 'selected_slot_not_open') {
          refreshOwnSchedule();
          showDialog({
            title: 'Schedule',
            message: 'One of those blocks is no longer open. Review your selection and try again.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (err.code === 'invalid_selected_slot_keys') {
          refreshOwnSchedule();
          showDialog({
            title: 'Schedule',
            message: 'Your schedule selection could not be read. Pick your blocks again.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        showDialog({
          title: 'Schedule',
          message: err.message || 'Could not share your schedule.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      showDialog({
        title: 'Schedule',
        message: 'Could not share your schedule. Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setIsSending(false);
    }
  }, [
    isSending,
    matchId,
    onActiveSuggestionConflict,
    onClose,
    onSent,
    refreshOwnSchedule,
    selectedSlotKeys,
    showDialog,
  ]);

  const canSend = selectedSlotKeys.length > 0 && !isSending;

  const footer = (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      <Text style={[styles.privacyText, { color: theme.textSecondary }]}>
        Only selected open blocks are shared. Busy/private and unselected times are never shown. Visible for 48 hours.
      </Text>
      <Pressable
        onPress={() => void handleSend()}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.shareButton,
          { backgroundColor: canSend ? theme.tint : theme.muted, opacity: pressed && canSend ? 0.9 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Share selected schedule blocks"
      >
        {isSending ? (
          <ActivityIndicator color={theme.primaryForeground} />
        ) : (
          <Text style={[styles.shareButtonText, { color: theme.primaryForeground }]}>
            Share selected blocks{selectedSlotKeys.length > 0 ? ` (${selectedSlotKeys.length})` : ''}
          </Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <>
      <KeyboardAwareBottomSheetModal
        visible={visible}
        onRequestClose={onClose}
        backdropColor="rgba(0,0,0,0.85)"
        showHandle
        handleStyle={styles.handle}
        footer={footer}
      >
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: 'rgba(34,211,238,0.14)' }]}>
            <Ionicons name="calendar-outline" size={20} color={theme.neonCyan} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.text }]}>Share your Vibely Schedule</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Choose the open blocks you want to share with {partnerName}.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.muted, opacity: pressed ? 0.82 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close schedule share"
          >
            <Ionicons name="close" size={18} color={theme.text} />
          </Pressable>
        </View>

        <ScheduleSharePicker onSelectionChange={handleSelectionChange} />
      </KeyboardAwareBottomSheetModal>
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  handle: { width: 88, height: 6, borderRadius: radius.pill, marginTop: spacing.md, marginBottom: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  privacyText: { fontFamily: fonts.body, fontSize: 11, lineHeight: 16 },
  shareButton: {
    minHeight: 46,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  shareButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
});
