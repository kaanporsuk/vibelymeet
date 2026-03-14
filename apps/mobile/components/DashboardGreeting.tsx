/**
 * Dashboard greeting block — web parity: greeting line + first name + optional "Complete profile" chip.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, typography } from '@/constants/theme';
import { fetchMyProfile } from '@/lib/profileApi';
import type { ProfileRow } from '@/lib/profileApi';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function calculateCompleteness(profile: ProfileRow | null): number {
  if (!profile) return 0;
  const checks = [
    !!profile.name,
    (profile.photos?.length ?? 0) >= 1,
    (profile.photos?.length ?? 0) >= 3,
    !!profile.about_me,
    !!profile.job,
    !!profile.location,
    (profile.interested_in?.length ?? 0) >= 1,
    !!profile.looking_for,
    !!profile.tagline,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function DashboardGreeting() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((data) => {
        if (!cancelled) setProfile(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => { cancelled = true; };
  }, []);

  const firstName = profile?.name?.split(' ')[0] || 'Viber';
  const completeness = calculateCompleteness(profile);

  return (
    <View style={styles.wrapper}>
      <View>
        <Text style={[styles.greeting, { color: theme.textSecondary }]}>{getGreeting()},</Text>
        <Text style={[styles.name, { color: theme.text }]}>{firstName}</Text>
      </View>
      {completeness < 80 && (
        <Pressable
          onPress={() => router.push('/profile')}
          style={[styles.chip, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
        >
          <Text style={[styles.chipText, { color: theme.accent }]} numberOfLines={1}>
            Complete your profile
          </Text>
          <Ionicons name="chevron-forward" size={12} color={theme.accent} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  greeting: { ...typography.body, marginBottom: 2 },
  name: { ...typography.titleLG, fontSize: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: 4,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
});
