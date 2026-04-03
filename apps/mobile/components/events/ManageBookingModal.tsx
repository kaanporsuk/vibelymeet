/**
 * Manage booking modal — parity with web: admission (confirmed vs waitlist), venue, share, cancel.
 */
import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';

export type BookingAdmissionStatus = 'confirmed' | 'waitlisted';

type ManageBookingModalProps = {
  visible: boolean;
  onClose: () => void;
  onCancel: () => void;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  ticketNumber: string;
  price: number;
  isVirtual?: boolean;
  /** Confirmed = lobby-eligible when live; waitlist must not imply lobby access. */
  admissionStatus?: BookingAdmissionStatus;
};

export function ManageBookingModal({
  visible,
  onClose,
  onCancel,
  eventTitle,
  eventDate,
  eventTime,
  venue,
  ticketNumber,
  price,
  isVirtual = false,
  admissionStatus = 'confirmed',
}: ManageBookingModalProps) {
  const theme = Colors[useColorScheme()];
  const isWaitlisted = admissionStatus === 'waitlisted';
  const headerTitle = isWaitlisted ? 'Your waitlist spot' : 'Your Ticket';
  const releaseCta = isWaitlisted ? 'Leave waitlist' : 'Cancel My Spot';

  const handleShare = async () => {
    try {
      await Share.share({
        title: `My Vibely Ticket - ${eventTitle}`,
        message: `I'm going to ${eventTitle}! Join me on Vibely.`,
      });
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.glassSurface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.muted }]} />
          <View style={[styles.header, { borderBottomColor: theme.glassBorder }]}>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
            <View style={styles.ticketHeader}>
              <View style={[styles.ticketIcon, { backgroundColor: theme.tint }]}>
                <Ionicons name="ticket" size={28} color="#fff" />
              </View>
              <View>
                <Text style={[styles.sheetTitle, { color: theme.text }]}>{headerTitle}</Text>
                <Text style={[styles.ticketRef, { color: theme.textSecondary }]}>{ticketNumber}</Text>
              </View>
            </View>
          </View>
          <View style={styles.body}>
            <View style={[styles.detailBlock, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <Text style={[styles.eventTitle, { color: theme.text }]}>{eventTitle}</Text>
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={16} color={theme.tint} />
                <Text style={[styles.metaText, { color: theme.textSecondary }]}>{eventDate}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={16} color={theme.tint} />
                <Text style={[styles.metaText, { color: theme.textSecondary }]}>{eventTime}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={16} color={theme.tint} />
                <Text style={[styles.metaText, { color: theme.textSecondary }]}>{venue}</Text>
              </View>
            </View>
            {!isVirtual ? (
              <View style={[styles.qrBlock, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {isWaitlisted ? (
                  <Text style={[styles.qrHint, { color: theme.textSecondary }]}>
                    You have a paid waitlist spot, not a confirmed seat yet. In-person check-in details appear if you’re promoted
                    before the event — keep an eye on the event page.
                  </Text>
                ) : (
                  <>
                    <Ionicons name="qr-code" size={64} color={theme.textSecondary} />
                    <Text style={[styles.qrHint, { color: theme.textSecondary }]}>Show this at the door for check-in</Text>
                  </>
                )}
              </View>
            ) : (
              <View style={[styles.qrBlock, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="videocam" size={40} color={theme.tint} />
                <Text style={[styles.qrHint, { color: theme.textSecondary }]}>
                  {isWaitlisted ? (
                    <>
                      The live lobby is for <Text style={{ fontWeight: '600', color: theme.text }}>confirmed</Text> guests. On the
                      waitlist, you’ll only use <Text style={{ fontWeight: '600', color: theme.text }}>Enter Lobby</Text> if you’re
                      promoted to a confirmed seat — we’ll update your status here when that happens.
                    </>
                  ) : (
                    <>
                      Join via the <Text style={{ fontWeight: '600', color: theme.text }}>Enter Lobby</Text> button when the event is
                      live
                    </>
                  )}
                </Text>
              </View>
            )}
            <View style={[styles.priceRow, { backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.priceLabel, { color: theme.textSecondary }]}>{price <= 0 ? 'Price' : 'Amount paid'}</Text>
              <Text style={[styles.priceValue, { color: theme.text }]}>{price <= 0 ? 'Free' : `€${price.toFixed(2)}`}</Text>
            </View>
            {price > 0 ? (
              <Text style={[styles.refundHint, { color: theme.textSecondary }]}>Refund exceptions are reviewed manually by support and are not automatic in-app.</Text>
            ) : null}
            <VibelyButton label="Share Event" onPress={handleShare} variant="secondary" style={styles.shareBtn} />
            <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.cancelText, { color: theme.danger }]}>{releaseCta}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingBottom: spacing['3xl'],
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 100,
    height: 8,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  header: { padding: spacing.lg, borderBottomWidth: 1 },
  closeBtn: { position: 'absolute', top: spacing.lg, right: spacing.lg, zIndex: 1, padding: spacing.xs },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ticketIcon: { width: 56, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  ticketRef: { fontSize: 13, marginTop: 2 },
  body: { padding: spacing.lg, gap: spacing.lg },
  detailBlock: { padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1 },
  eventTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  metaText: { fontSize: 14 },
  qrBlock: { padding: spacing.xl, borderRadius: radius.xl, borderWidth: 1, alignItems: 'center', gap: spacing.sm },
  qrHint: { fontSize: 12, textAlign: 'center' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderRadius: radius.lg },
  priceLabel: { fontSize: 14 },
  priceValue: { fontSize: 18, fontWeight: '700' },
  refundHint: { fontSize: 12, textAlign: 'center', marginTop: -8 },
  shareBtn: {},
  cancelBtn: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '500' },
});
