/**
 * Full-screen mutual-match celebration shown after a video date when both
 * participants vibed. Matches the emotional weight of the web MatchSuccessModal.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Animated,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';

interface MatchCelebrationScreenProps {
  partnerName: string;
  partnerImage: string | null;
  sharedVibes?: string[];
  isLoadingSharedVibes?: boolean;
  vibeScore?: number;
  onStartChatting: () => void;
  onKeepVibing: () => void;
}

export function MatchCelebrationScreen({
  partnerName,
  partnerImage,
  sharedVibes = [],
  isLoadingSharedVibes = false,
  vibeScore,
  onStartChatting,
  onKeepVibing,
}: MatchCelebrationScreenProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  // Entry animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const titleSlide = useRef(new Animated.Value(30)).current;
  const cardSlide = useRef(new Animated.Value(50)).current;
  const btnSlide = useRef(new Animated.Value(60)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Staggered entrance
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      ]),
      Animated.stagger(80, [
        Animated.timing(titleSlide, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(cardSlide, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(btnSlide, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();

    // Continuous avatar pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: '#050508' }]}>
      {/* Ambient glow */}
      <View
        style={[
          styles.glow,
          { backgroundColor: withAlpha(theme.tint, 0.18) },
        ]}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Headline */}
        <Animated.View
          style={[
            styles.headlineWrap,
            { opacity: fadeAnim, transform: [{ translateY: titleSlide }] },
          ]}
        >
          <Text style={styles.headline}>IT'S A VIBE! 💜</Text>
          <Text style={[styles.subline, { color: theme.textSecondary }]}>
            You and {partnerName} matched
          </Text>
        </Animated.View>

        {/* Avatar */}
        <Animated.View
          style={[
            styles.avatarWrap,
            { opacity: fadeAnim, transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }] },
          ]}
        >
          {/* Glow ring */}
          <View
            style={[
              styles.avatarRing,
              { borderColor: withAlpha(theme.tint, 0.7) },
            ]}
          />
          {partnerImage ? (
            <Image source={{ uri: partnerImage }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: theme.muted }]}>
              <Ionicons name="person" size={48} color={theme.textSecondary} />
            </View>
          )}
          {/* Heart badge */}
          <View style={[styles.heartBadge, { backgroundColor: theme.tint }]}>
            <Ionicons name="heart" size={16} color="#fff" />
          </View>
        </Animated.View>

        {/* Vibe score */}
        {vibeScore !== undefined && vibeScore > 0 && (
          <Animated.View
            style={[
              styles.scoreWrap,
              { opacity: fadeAnim, transform: [{ translateY: cardSlide }] },
            ]}
          >
            <View style={[styles.scorePill, { backgroundColor: withAlpha('#FFD700', 0.18), borderColor: withAlpha('#FFD700', 0.35) }]}>
              <Ionicons name="heart" size={14} color="#FFD700" />
              <Text style={[styles.scoreText, { color: '#FFD700' }]}>
                {vibeScore}% Chemistry
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Shared vibes */}
        {(isLoadingSharedVibes || sharedVibes.length > 0) && (
          <Animated.View
            style={[
              styles.vibesCard,
              {
                opacity: fadeAnim,
                transform: [{ translateY: cardSlide }],
                backgroundColor: withAlpha(theme.tint, 0.08),
                borderColor: withAlpha(theme.tint, 0.2),
              },
            ]}
          >
            <View style={styles.vibesHeader}>
              <Ionicons name="sparkles" size={14} color={theme.tint} />
              <Text style={[styles.vibesLabel, { color: theme.textSecondary }]}>
                You both vibe on:
              </Text>
            </View>
            <View style={styles.vibeChips}>
              {isLoadingSharedVibes ? (
                <>
                  <View style={[styles.skeletonChip, { backgroundColor: withAlpha(theme.text, 0.12) }]} />
                  <View style={[styles.skeletonChipWide, { backgroundColor: withAlpha(theme.text, 0.12) }]} />
                </>
              ) : (
                sharedVibes.map((v) => (
                  <View
                    key={v}
                    style={[
                      styles.chip,
                      { backgroundColor: withAlpha('#FFD700', 0.15), borderColor: withAlpha('#FFD700', 0.3) },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: theme.text }]}>{v}</Text>
                  </View>
                ))
              )}
            </View>
          </Animated.View>
        )}

        {/* CTAs */}
        <Animated.View
          style={[
            styles.ctaWrap,
            { opacity: fadeAnim, transform: [{ translateY: btnSlide }] },
          ]}
        >
          <Pressable
            onPress={onStartChatting}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityLabel="Start chatting"
          >
            <Ionicons name="chatbubble-ellipses" size={20} color="#fff" style={styles.btnIcon} />
            <Text style={styles.primaryBtnText}>Start Chatting</Text>
          </Pressable>

          <Pressable
            onPress={onKeepVibing}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Keep vibing"
          >
            <Text style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>
              Keep Vibing →
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  glow: {
    position: 'absolute',
    top: -100,
    left: '50%',
    marginLeft: -180,
    width: 360,
    height: 360,
    borderRadius: 180,
    ...Platform.select({ ios: { shadowColor: '#8B5CF6', shadowRadius: 80, shadowOpacity: 0.6 } }),
  },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  headlineWrap: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  headline: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subline: {
    fontSize: 16,
    textAlign: 'center',
  },
  avatarWrap: {
    position: 'relative',
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    position: 'absolute',
    inset: -6,
    width: 152,
    height: 152,
    borderRadius: 76,
    borderWidth: 2,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  avatarFallback: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#050508',
  },
  scoreWrap: {
    alignItems: 'center',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700',
  },
  vibesCard: {
    width: '100%',
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  vibesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  vibesLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  vibeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  skeletonChip: {
    width: 86,
    height: 30,
    borderRadius: 999,
  },
  skeletonChipWide: {
    width: 118,
    height: 30,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  ctaWrap: {
    width: '100%',
    gap: spacing.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
  },
  btnIcon: {
    marginRight: spacing.sm,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
