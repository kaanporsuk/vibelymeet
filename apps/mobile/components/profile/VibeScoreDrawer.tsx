import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts } from '@/constants/theme';
import type { ProfileRow } from '@/lib/profileApi';
import {
  getIncompleteVibeScoreActions,
  getNextTierLine,
  tierLabelFromScore,
  type VibeScoreActionId,
} from '@/lib/vibeScoreIncompleteActions';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_MAX = Math.min(SCREEN_H * 0.78, 620);
const PILL_LIMIT = 6;

export type VibeScoreDrawerProps = {
  visible: boolean;
  onClose: () => void;
  profile: ProfileRow;
  score: number;
  onAction: (action: VibeScoreActionId) => void;
};

export default function VibeScoreDrawer({
  visible,
  onClose,
  profile,
  score,
  onAction,
}: VibeScoreDrawerProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (visible) setShowAll(false);
  }, [visible]);

  const clamped = Math.min(100, Math.max(0, score));
  const tierLabel = profile.vibe_score_label?.trim() || tierLabelFromScore(clamped);
  const nextTier = getNextTierLine(clamped);
  const actions = getIncompleteVibeScoreActions(profile);
  const hasIncomplete = actions.length > 0;
  const displayed = showAll ? actions : actions.slice(0, PILL_LIMIT);
  const hiddenCount = Math.max(0, actions.length - PILL_LIMIT);

  const handlePill = (id: VibeScoreActionId) => {
    onClose();
    requestAnimationFrame(() => onAction(id));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.modalRoot}>
          <Pressable style={s.backdropPress} onPress={onClose} accessibilityLabel="Close sheet" />
          <Pressable
            style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.glassBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={s.handleRow}>
              <View style={[s.handle, { backgroundColor: theme.textSecondary }]} />
            </View>

            <View style={s.headerRow}>
              <Text style={[s.headerTitle, { color: theme.text }]}>Vibe Score</Text>
              <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: SHEET_MAX - 48 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[s.bigScore, { color: theme.text }]}>{Math.round(clamped)}</Text>
              <Text style={[s.tierLine, { color: '#E84393' }]}>
                Vibe Score · {tierLabel}
              </Text>
              {nextTier ? (
                <Text style={[s.muted, { color: theme.textSecondary }]}>
                  Next tier: {nextTier.name} at {nextTier.at}
                </Text>
              ) : (
                <View style={s.maxedRow}>
                  <Ionicons name="checkmark-circle" size={16} color="#2DD4BF" />
                  <Text style={[s.muted, { color: theme.textSecondary, marginLeft: 6 }]}>
                    Maxed out
                  </Text>
                </View>
              )}

              <View style={[s.barTrack, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[s.barFill, { width: `${clamped}%` }]}
                />
              </View>

              <Text style={[s.boostTitle, { color: theme.textSecondary }]}>Boost your score</Text>

              {hasIncomplete ? (
                <>
                  {displayed.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => handlePill(a.id)}
                      style={({ pressed }) => [
                        s.pill,
                        { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.08)' },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Ionicons name={a.icon} size={18} color="#8B5CF6" />
                      <Text style={s.pillLabel} numberOfLines={2}>
                        {a.label}
                      </Text>
                      <Text style={s.pillPoints}>+{a.points}</Text>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.28)" />
                    </Pressable>
                  ))}
                  {!showAll && hiddenCount > 0 ? (
                    <Pressable onPress={() => setShowAll(true)} style={s.seeAll}>
                      <Text style={[s.seeAllText, { color: theme.tint }]}>See all ({actions.length})</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={[s.celebrate, { color: theme.text }]}>
                  Your profile is in the top tier
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  sheet: {
    maxHeight: SHEET_MAX,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 34,
    zIndex: 10,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
  },
  bigScore: {
    fontSize: 30,
    fontFamily: fonts.displayBold,
    marginBottom: 4,
  },
  tierLine: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 6,
  },
  muted: {
    fontSize: 13,
    fontFamily: fonts.body,
    marginBottom: spacing.md,
  },
  maxedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  boostTitle: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  pillLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: fonts.bodyMedium,
    color: '#fff',
  },
  pillPoints: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.bodyBold,
    color: '#8B5CF6',
  },
  seeAll: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  seeAllText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  celebrate: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
