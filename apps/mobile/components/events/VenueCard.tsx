/**
 * Venue card — parity with web: virtual (digital lobby, Enter Lobby when live) or physical (venue, address, directions).
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { Card, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';

type VenueCardProps = {
  isVirtual: boolean;
  venueName?: string;
  address?: string;
  eventDate: Date;
  eventDurationMinutes?: number;
  eventId?: string;
  isRegistered?: boolean;
  onAccessPress?: () => void;
  accessLabel?: string;
  accessDisabled?: boolean;
};

export function VenueCard({
  isVirtual,
  venueName,
  address,
  eventDate,
  eventDurationMinutes = 60,
  eventId,
  isRegistered = false,
  onAccessPress,
  accessLabel = 'Get Tickets',
  accessDisabled = false,
}: VenueCardProps) {
  const theme = Colors[useColorScheme()];
  const router = useRouter();
  const [timeUntil, setTimeUntil] = useState('');
  const [eventStatus, setEventStatus] = useState<'upcoming' | 'live' | 'ended'>('upcoming');

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const start = eventDate.getTime();
      const end = start + eventDurationMinutes * 60 * 1000;
      if (now >= end) {
        setEventStatus('ended');
        setTimeUntil('Event ended');
        return;
      }
      if (now >= start && now < end) {
        setEventStatus('live');
        const m = Math.ceil((end - now) / (1000 * 60));
        setTimeUntil(`${m}m remaining`);
        return;
      }
      setEventStatus('upcoming');
      const diff = start - now;
      if (diff <= 0) {
        setTimeUntil('Starting now!');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 24) setTimeUntil(`${Math.floor(hours / 24)}d ${hours % 24}h`);
      else if (hours > 0) setTimeUntil(`${hours}h ${minutes}m`);
      else setTimeUntil(`${minutes}m`);
    };
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, [eventDate.getTime(), eventDurationMinutes]);

  const onEnterLobby = () => {
    if (eventId && eventStatus === 'live') router.push(`/event/${eventId}/lobby` as const);
  };

  if (isVirtual) {
    return (
      <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
            <Ionicons name="videocam" size={24} color={theme.tint} />
          </View>
          <View style={styles.heading}>
            <Text style={[styles.venueTitle, { color: theme.text }]}>Digital Lobby</Text>
            <Text style={[styles.venueSub, { color: theme.textSecondary }]}>Video Speed Dating</Text>
          </View>
        </View>
        <View style={[styles.statusBlock, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          {eventStatus === 'live' && isRegistered ? (
            <>
              <View style={styles.liveRow}>
                <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
                <Text style={[styles.liveText, { color: theme.success }]}>LIVE NOW</Text>
              </View>
              <Text style={[styles.timeUntil, { color: theme.textSecondary }]}>{timeUntil}</Text>
            </>
          ) : eventStatus === 'ended' ? (
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
        {eventStatus === 'live' && isRegistered ? (
          <VibelyButton label="Enter Lobby" onPress={onEnterLobby} variant="gradient" style={styles.cta} />
        ) : eventStatus === 'ended' ? (
          <VibelyButton label="Event Ended" onPress={() => {}} variant="secondary" disabled style={styles.cta} />
        ) : isRegistered ? (
          <VibelyButton label="Lobby Opens Soon" onPress={() => {}} variant="secondary" disabled style={styles.cta} />
        ) : (
          onAccessPress ? (
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
          )
        )}
      </Card>
    );
  }

  return (
    <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: withAlpha(theme.accent, 0.15) }]}>
          <Ionicons name="location" size={24} color={theme.accent} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.venueTitle, { color: theme.text }]}>{venueName || 'Secret Location'}</Text>
          <Text style={[styles.venueSub, { color: theme.textSecondary }]}>{address || 'Address revealed after registration'}</Text>
        </View>
      </View>
      <View style={[styles.mapPlaceholder, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <Ionicons name="map" size={40} color={theme.textSecondary} />
      </View>
      <VibelyButton label="Get Directions" onPress={() => {}} variant="secondary" style={styles.cta} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, marginBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  iconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 },
  venueTitle: { fontSize: 16, fontWeight: '600' },
  venueSub: { fontSize: 13, marginTop: 2 },
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
  mapPlaceholder: { height: 120, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
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
