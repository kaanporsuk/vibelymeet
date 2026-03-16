/**
 * Full-screen preview of profile as others see it. Reference: src/components/ProfilePreview.tsx
 */
import React, { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Image, Dimensions, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, typography } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import { avatarUrl } from '@/lib/imageUrl';
import { RELATIONSHIP_INTENT_OPTIONS } from './RelationshipIntentSelector';
import { LIFESTYLE_CATEGORIES } from './LifestyleDetailsSection';
import { PROMPT_EMOJIS } from './PROMPT_CONSTANTS';
import type { ProfileRow } from '@/lib/profileApi';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ProfilePreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  profile: ProfileRow | null;
};

export function ProfilePreviewModal({ visible, onClose, profile }: ProfilePreviewModalProps) {
  const theme = Colors[useColorScheme()];
  const [photoIndex, setPhotoIndex] = useState(0);

  if (!visible || !profile) return null;

  const photos = profile.photos ?? [];
  const photoUrls = photos.length > 0 ? photos : (profile.avatar_url ? [profile.avatar_url] : []);
  const lookingForLabel = profile.looking_for ? RELATIONSHIP_INTENT_OPTIONS.find((o) => o.id === profile.looking_for)?.label ?? profile.looking_for : null;
  const lifestyle = profile.lifestyle ?? {};
  const prompts = (profile.prompts ?? []).filter((p) => p?.question && p?.answer);

  return (
    <Modal visible transparent animationType="slide">
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <VibelyText variant="overline" style={[styles.previewLabel, { color: theme.textSecondary }]}>Preview — as others see you</VibelyText>
          <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surfaceSubtle }]} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero photo carousel */}
          <View style={[styles.heroWrap, { backgroundColor: theme.surfaceSubtle }]}>
            {photoUrls.length > 0 ? (
              <FlatList
                data={photoUrls}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const i = Math.round(e.nativeEvent.contentOffset.x / (SCREEN_WIDTH - spacing.lg * 2));
                  setPhotoIndex(Math.min(i, photoUrls.length - 1));
                }}
                keyExtractor={(_, i) => String(i)}
                renderItem={({ item }) => (
                  <View style={styles.heroSlide}>
                    <Image source={{ uri: avatarUrl(item) }} style={styles.heroImg} resizeMode="cover" />
                  </View>
                )}
              />
            ) : (
              <View style={[styles.heroPlaceholder, { backgroundColor: theme.muted }]}>
                <VibelyText variant="titleLG" style={{ color: theme.textSecondary }}>{profile.name?.[0] ?? '?'}</VibelyText>
              </View>
            )}
            {photoUrls.length > 1 && (
              <View style={styles.dots}>
                {photoUrls.map((_, i) => (
                  <View key={i} style={[styles.dot, i === photoIndex && { backgroundColor: theme.tint }]} />
                ))}
              </View>
            )}
          </View>

          {/* Name, age */}
          <View style={styles.section}>
            <VibelyText variant="titleLG" style={{ color: theme.text }}>
              {profile.name ?? 'Unknown'}{profile.age ? `, ${profile.age}` : ''}
            </VibelyText>
          </View>

          {/* Verification badges */}
          {(profile.phone_verified || profile.email_verified || profile.photo_verified) && (
            <View style={styles.section}>
              <View style={styles.badgesRow}>
                {profile.phone_verified && <View style={[styles.miniBadge, { backgroundColor: `${theme.success}20` }]}><Ionicons name="checkmark-circle" size={14} color={theme.success} /><Text style={[styles.miniBadgeText, { color: theme.success }]}>Phone</Text></View>}
                {profile.photo_verified && <View style={[styles.miniBadge, { backgroundColor: `${theme.success}20` }]}><Ionicons name="camera" size={14} color={theme.success} /><Text style={[styles.miniBadgeText, { color: theme.success }]}>Photo</Text></View>}
              </View>
            </View>
          )}

          {/* Relationship intent */}
          {lookingForLabel && (
            <View style={[styles.chipWrap, { backgroundColor: theme.tintSoft }]}>
              <VibelyText variant="body" style={{ color: theme.tint }}>{lookingForLabel}</VibelyText>
            </View>
          )}

          {/* Bio */}
          {profile.about_me ? (
            <View style={styles.section}>
              <VibelyText variant="body" style={{ color: theme.text }}>{profile.about_me}</VibelyText>
            </View>
          ) : null}

          {/* Job, location, height */}
          <View style={styles.metaRow}>
            {profile.job ? <View style={styles.metaItem}><Ionicons name="briefcase-outline" size={16} color={theme.textSecondary} /><VibelyText variant="body" style={{ color: theme.text }}>{profile.job}</VibelyText></View> : null}
            {profile.location ? <View style={styles.metaItem}><Ionicons name="location-outline" size={16} color={theme.textSecondary} /><VibelyText variant="body" style={{ color: theme.text }}>{profile.location}</VibelyText></View> : null}
            {profile.height_cm ? <View style={styles.metaItem}><VibelyText variant="body" style={{ color: theme.text }}>{profile.height_cm} cm</VibelyText></View> : null}
          </View>

          {/* Vibes */}
          {profile.vibes?.length ? (
            <View style={styles.section}>
              <View style={styles.chipWrap}>
                {profile.vibes.map((v) => (
                  <View key={v} style={[styles.chip, { backgroundColor: theme.surfaceSubtle }]}>
                    <VibelyText variant="caption" style={{ color: theme.text }}>{v}</VibelyText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Prompts */}
          {prompts.length > 0 && prompts.map((p, i) => (
            <View key={i} style={[styles.promptCard, { backgroundColor: theme.surfaceSubtle }]}>
              <View style={styles.promptHeader}>
                <Text style={styles.promptEmoji}>{PROMPT_EMOJIS[p.question] ?? '💭'}</Text>
                <VibelyText variant="caption" style={{ color: theme.textSecondary }}>{p.question}</VibelyText>
              </View>
              <VibelyText variant="body" style={{ color: theme.text }}>{p.answer}</VibelyText>
            </View>
          ))}

          {/* Lifestyle */}
          {Object.keys(lifestyle).length > 0 && (
            <View style={styles.section}>
              <VibelyText variant="overline" style={{ color: theme.textSecondary }}>Lifestyle</VibelyText>
              <View style={styles.chipWrap}>
                {LIFESTYLE_CATEGORIES.filter((c) => lifestyle[c.id]).map((c) => {
                  const opt = c.options.find((o) => o.value === lifestyle[c.id]);
                  return opt ? (
                    <View key={c.id} style={[styles.chip, { backgroundColor: theme.surfaceSubtle }]}>
                      <VibelyText variant="caption" style={{ color: theme.text }}>{c.label}: {opt.label}</VibelyText>
                    </View>
                  ) : null;
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.sm },
  previewLabel: {},
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 80 },
  heroWrap: { width: SCREEN_WIDTH - spacing.lg * 2, height: 360, borderRadius: radius['2xl'], overflow: 'hidden', alignSelf: 'center', marginBottom: spacing.md },
  heroSlide: { width: SCREEN_WIDTH - spacing.lg * 2, height: 360 },
  heroImg: { width: '100%', height: '100%' },
  heroPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  section: { marginBottom: spacing.md },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill },
  miniBadgeText: { fontSize: 12, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promptCard: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.sm },
  promptHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  promptEmoji: { fontSize: 18 },
});
