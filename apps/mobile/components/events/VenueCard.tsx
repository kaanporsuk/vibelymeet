/**
 * Online lobby card — parity with web: Enter Lobby when live, otherwise online access status.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Card, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { deriveEventPhase, formatVenuePhaseLabel } from '@/lib/eventPhase';

type VenueCardProps = {
  eventDate: Date;
  eventDurationMinutes?: number;
  eventStatus?: string | null;
  eventEndedAt?: Date | string | number | null;
  currentTimeMs?: number;
  eventId?: string;
  isRegistered?: boolean;
  onAccessPress?: () => void;
  accessLabel?: string;
  accessDisabled?: boolean;
};

export function VenueCard({
  eventDate,
  eventDurationMinutes = 60,
  eventStatus,
  eventEndedAt,
  currentTimeMs,
  eventId,
  isRegistered = false,
  onAccessPress,
  accessLabel = 'Reserve Spot',
  accessDisabled = false,
}: VenueCardProps) {
  const theme = Colors[useColorScheme()];
  const router = useRouter();
  const [fallbackNowMs, setFallbackNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof currentTimeMs === 'number') return;
    const timer = setInterval(() => setFallbackNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [currentTimeMs]);

  const phase = deriveEventPhase({
    eventDate,
    eventDurationMinutes,
    status: eventStatus,
    endedAt: eventEndedAt,
    nowMs: typeof currentTimeMs === 'number' ? currentTimeMs : fallbackNowMs,
  });
  const timeUntil = formatVenuePhaseLabel(phase);

  const onEnterLobby = () => {
    if (eventId && phase.isLive) router.push(`/event/${eventId}/lobby` as const);
  };

  return (
    <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="videocam" size={24} color={theme.tint} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.lobbyTitle, { color: theme.text }]}>Digital Lobby</Text>
          <Text style={[styles.lobbySub, { color: theme.textSecondary }]}>Video Speed Dating</Text>
        </View>
      </View>
      <View style={[styles.statusBlock, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        {phase.isLive && isRegistered ? (
          <>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
              <Text style={[styles.liveText, { color: theme.success }]}>LIVE NOW</Text>
            </View>
            <Text style={[styles.timeUntil, { color: theme.textSecondary }]}>{timeUntil}</Text>
          </>
        ) : phase.isEnded ? (
          <>
            <Ionicons name="lock-closed" size={24} color={theme.textSecondary} />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>Event has ended</Text>
          </>
        ) : isRegistered ? (
          <>
            <Ionicons name="wifi" size={24} color={theme.tint} />
            <Text style={[styles.statusText, { color: theme.text }]}>Ready to connect</Text>
            <Text style={[styles.timeUntil, { color: theme.textSecondary }]}>Lobby opens in: {timeUntil}</Text>
          </>
        ) : (
          <>
            <Ionicons name="lock-closed" size={24} color={theme.textSecondary} />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>Register to unlock access</Text>
          </>
        )}
      </View>
      {phase.isLive && isRegistered ? (
        <VibelyButton label="Enter Lobby" onPress={onEnterLobby} variant="gradient" style={styles.cta} />
      ) : phase.isEnded ? (
        <VibelyButton label="Event Ended" onPress={() => {}} variant="secondary" disabled style={styles.cta} />
      ) : isRegistered ? (
        <VibelyButton label="Lobby Opens Soon" onPress={() => {}} variant="secondary" disabled style={styles.cta} />
      ) : onAccessPress ? (
        <VibelyButton
          label={accessLabel}
          onPress={onAccessPress}
          disabled={accessDisabled}
          variant="secondary"
          style={styles.cta}
        />
      ) : (
        <View style={[styles.lockedHint, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Ionicons name="lock-closed-outline" size={14} color={theme.textSecondary} />
          <Text style={[styles.lockedHintText, { color: theme.textSecondary }]}>Register from the event details CTA below</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, marginBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  iconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 },
  lobbyTitle: { fontSize: 16, fontWeight: '600' },
  lobbySub: { fontSize: 13, marginTop: 2 },
  statusBlock: {
    minHeight: 100,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: 4,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 13, fontWeight: '700' },
  timeUntil: { fontSize: 12 },
  statusText: { fontSize: 14, fontWeight: '500' },
  cta: { alignSelf: 'stretch' },
  lockedHint: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  lockedHintText: { fontSize: 12, fontWeight: '500' },
});
