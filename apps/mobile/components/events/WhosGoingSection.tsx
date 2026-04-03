/**
 * Who's Going: privacy-aware preview (top-2 sharp + obscured remainder) or aggregate-only teaser.
 */

import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const AVATAR_SIZE = 44;

export type AttendeeDisplay = {
  id: string;
  name: string;
  avatarUrl: string;
};

type AggregateProps = {
  mode: 'aggregate';
  viewerAdmission: 'waitlisted' | 'none';
  totalOtherConfirmed: number;
};

type PreviewProps = {
  mode: 'preview';
  revealed: AttendeeDisplay[];
  obscuredCount: number;
  totalOtherConfirmed: number;
  visibleCohortCount: number;
  loading?: boolean;
  onAttendeePress?: (attendee: AttendeeDisplay) => void;
};

type Props = AggregateProps | PreviewProps;

const LOCK_PLACEHOLDER_COUNT = 6;

export function WhosGoingSection(props: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (props.mode === 'aggregate') {
    const { viewerAdmission, totalOtherConfirmed } = props;
    const countLabel =
      totalOtherConfirmed === 1 ? '1 person is going' : `${totalOtherConfirmed} people are going`;
    const subtitle =
      viewerAdmission === 'waitlisted'
        ? "Confirm your spot to see who you're most aligned with."
        : "Get tickets to unlock personalized previews of who's going.";

    return (
      <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <View style={styles.header}>
          <Ionicons name="people-outline" size={20} color={theme.tint} />
          <Text style={[styles.title, { color: theme.text }]}>Who's Going</Text>
          <View style={styles.headerRight}>
            <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.countInline, { color: theme.textSecondary }]} numberOfLines={1}>
              {countLabel}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.avatarRow}
        >
          {Array.from({ length: LOCK_PLACEHOLDER_COUNT }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.lockCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <View style={[styles.lockCircle, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}>
                <Ionicons name="lock-closed" size={22} color={theme.textSecondary} />
              </View>
              <View style={[styles.shimmerBar, styles.shimmerBarSm, { backgroundColor: theme.muted }]} />
              <View style={[styles.shimmerBar, styles.shimmerBarLg, { backgroundColor: theme.muted }]} />
            </View>
          ))}
        </ScrollView>

        <View style={[styles.teaserFooter, { backgroundColor: theme.surface, borderColor: theme.tint }]}>
          <View style={[styles.sparkleIcon, { backgroundColor: theme.tint }]}>
            <Ionicons name="sparkles" size={18} color="#fff" />
          </View>
          <View style={styles.teaserCopy}>
            <Text style={[styles.teaserTitle, { color: theme.text }]}>{countLabel}</Text>
            <Text style={[styles.teaserSub, { color: theme.textSecondary }]}>{subtitle}</Text>
          </View>
        </View>
      </View>
    );
  }

  const {
    revealed,
    obscuredCount,
    totalOtherConfirmed,
    visibleCohortCount,
    loading,
    onAttendeePress,
  } = props;

  const cohortLine =
    visibleCohortCount === 0
      ? 'No one else matches your visibility yet'
      : visibleCohortCount === 1
        ? '1 other in your visibility'
        : `${visibleCohortCount} others in your visibility`;

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <View style={styles.header}>
        <Ionicons name="people-outline" size={20} color={theme.tint} />
        <Text style={[styles.title, { color: theme.text }]}>Who's Going</Text>
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading preview…</Text>
        </View>
      ) : null}
      <Text style={[styles.count, { color: theme.textSecondary }]}>
        {totalOtherConfirmed === 1 ? '1 other confirmed' : `${totalOtherConfirmed} others confirmed`}
      </Text>
      <Text style={[styles.cohortHint, { color: theme.textSecondary }]}>{cohortLine}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.avatarRow}
      >
        {revealed.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => onAttendeePress?.(a)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Image
              source={{ uri: a.avatarUrl }}
              style={[styles.avatar, { borderColor: theme.border }]}
            />
          </Pressable>
        ))}
        {obscuredCount > 0 ? (
          <View style={[styles.obscuredWrap, { borderColor: theme.border }]}>
            <BlurView
              intensity={48}
              tint={colorScheme === 'dark' ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.obscuredInner}>
              <Ionicons name="lock-closed" size={20} color={theme.textSecondary} />
              <Text style={[styles.obscuredLabel, { color: theme.textSecondary }]}>+{obscuredCount}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    flexShrink: 1,
  },
  title: {
    ...typography.titleMD,
    fontSize: 18,
  },
  countInline: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 180,
  },
  count: {
    ...typography.body,
    marginBottom: spacing.xs,
  },
  cohortHint: {
    fontSize: 12,
    marginBottom: spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
  },
  obscuredWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  obscuredInner: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  obscuredLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  lockCard: {
    width: 100,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  lockCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  shimmerBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 4,
  },
  shimmerBarSm: { width: 40 },
  shimmerBarLg: { width: 52 },
  teaserFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sparkleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teaserCopy: { flex: 1 },
  teaserTitle: { fontSize: 14, fontWeight: '600' },
  teaserSub: { fontSize: 12, marginTop: 2 },
  pressed: {
    opacity: 0.8,
  },
});
