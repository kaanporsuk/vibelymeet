import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { getMediaPlaybackQoeSnapshot, mediaConnectionSnapshot } from '@/lib/mediaPlaybackSessionPolicy';

export type NativeMediaHealthUploadSummary = {
  enqueued: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  queued: number;
};

type Props = {
  uploadSummary: NativeMediaHealthUploadSummary;
  onRetryFailed: () => void;
};

export function MediaHealthPanel({ uploadSummary, onRetryFailed }: Props) {
  const theme = Colors[useColorScheme()];
  const qoe = getMediaPlaybackQoeSnapshot();
  const connection = mediaConnectionSnapshot();
  const attempted = uploadSummary.succeeded + uploadSummary.failed;
  const successRate = attempted > 0 ? Math.round((uploadSummary.succeeded / attempted) * 100) : null;

  const card = (icon: ComponentProps<typeof Ionicons>['name'], label: string, value: string, detail: string) => (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={15} color={theme.textSecondary} />
        <Text style={[styles.cardLabel, { color: theme.textSecondary }]}>{label}</Text>
      </View>
      <Text style={[styles.cardValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>{detail}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Media health</Text>
      {card(
        'cloud-upload-outline',
        'Uploads',
        successRate == null ? 'No data' : `${successRate}%`,
        `${uploadSummary.succeeded} sent · ${uploadSummary.failed} failed · ${uploadSummary.inFlight + uploadSummary.queued} pending`,
      )}
      {card(
        'pulse-outline',
        'Playback',
        qoe.qoeDegraded ? 'Degraded' : 'Stable',
        `${qoe.recentRebufferCount} rebuffers · startup ${qoe.lastStartupMs == null ? 'unknown' : `${qoe.lastStartupMs} ms`}`,
      )}
      {card(
        'wifi-outline',
        'Connection',
        connection.effectiveType === 'unknown' ? 'Unknown' : connection.effectiveType.toUpperCase(),
        `${connection.saveData ? 'Save-data enabled' : 'Save-data off'} · prewarm ${Math.round(qoe.prewarmBytesUsed / 1024)} KB`,
      )}

      <Pressable
        style={[styles.retryButton, { backgroundColor: theme.tint }, uploadSummary.failed === 0 && styles.disabled]}
        disabled={uploadSummary.failed === 0}
        onPress={onRetryFailed}
        accessibilityRole="button"
        accessibilityLabel="Retry failed uploads"
      >
        <Ionicons name="refresh-outline" size={18} color={theme.primaryForeground} />
        <Text style={[styles.retryLabel, { color: theme.primaryForeground }]}>Retry failed uploads</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  title: { fontSize: 18, fontWeight: '800' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 14,
    gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 },
  cardValue: { fontSize: 22, fontWeight: '900' },
  cardDetail: { fontSize: 12, lineHeight: 17 },
  retryButton: {
    minHeight: 50,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  retryLabel: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});
