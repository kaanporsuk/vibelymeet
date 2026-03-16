/**
 * Sticky bottom pricing bar — parity with web: price/Free, capacity state, gender label, Purchase CTA.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';

type CapacityStatus = 'available' | 'filling' | 'almostFull';

type PricingBarProps = {
  price: number;
  capacityStatus: CapacityStatus;
  spotsLeft: number;
  genderLabel: string;
  onPurchase: () => void;
  isPurchasing?: boolean;
};

export function PricingBar({
  price,
  capacityStatus,
  spotsLeft,
  genderLabel,
  onPurchase,
  isPurchasing = false,
}: PricingBarProps) {
  const theme = Colors[useColorScheme()];
  const statusText =
    capacityStatus === 'almostFull' ? `Only ${spotsLeft} left!` : capacityStatus === 'filling' ? 'Filling Fast' : 'Spots Available';
  const statusColor = capacityStatus === 'almostFull' ? theme.danger : capacityStatus === 'filling' ? theme.neonYellow : theme.success;

  return (
    <View style={[styles.bar, { backgroundColor: theme.glassSurface, borderTopColor: theme.glassBorder }]}>
      <View style={styles.inner}>
        <View style={styles.left}>
          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: theme.text }]}>
              {price === 0 ? 'Free' : `€${Number(price).toFixed(2)}`}
            </Text>
            <View style={[styles.badge, { backgroundColor: withAlpha(statusColor, 0.19) }]}>
              <Text style={[styles.badgeText, { color: statusColor }]}>{statusText}</Text>
            </View>
          </View>
          <Text style={[styles.genderLabel, { color: theme.textSecondary }]}>Ticket price for {genderLabel}</Text>
        </View>
        <VibelyButton
          label={isPurchasing ? 'Processing…' : 'Purchase Ticket'}
          onPress={onPurchase}
          loading={isPurchasing}
          disabled={isPurchasing}
          variant="primary"
          size="lg"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl + 16,
  },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  left: { flex: 1, minWidth: 0 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  price: { fontSize: 22, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  genderLabel: { fontSize: 12, marginTop: 4 },
});
