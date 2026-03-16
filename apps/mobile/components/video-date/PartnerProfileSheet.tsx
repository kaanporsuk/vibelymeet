/**
 * Bottom sheet: partner photo, name, age, bio, job, location, vibe tags, prompts.
 */

import React from 'react';
import { Modal, View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { typography, spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { PartnerProfileData } from '@/lib/videoDateApi';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  partner: PartnerProfileData;
};

export function PartnerProfileSheet({ isOpen, onClose, partner }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const heroUrl = partner.photos?.[0] ?? partner.avatarUrl ?? null;

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={[styles.handle, { backgroundColor: theme.mutedForeground }]} />
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={[styles.closeText, { color: theme.text }]}>✕</Text>
        </Pressable>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroRow}>
            {heroUrl ? (
              <Image source={{ uri: heroUrl }} style={styles.heroImage} />
            ) : (
              <View style={[styles.heroPlaceholder, { backgroundColor: theme.muted }]}>
                <Text style={[styles.heroPlaceholderText, { color: theme.mutedForeground }]}>Photo</Text>
              </View>
            )}
            <View style={styles.heroInfo}>
              <Text style={[styles.name, { color: theme.text }]}>
                {partner.name}
                {partner.age > 0 ? `, ${partner.age}` : ''}
              </Text>
              {partner.job ? (
                <Text style={[styles.meta, { color: theme.mutedForeground }]}>{partner.job}</Text>
              ) : null}
            </View>
          </View>
          {partner.bio ? (
            <Text style={[styles.bio, { color: theme.text }]}>{partner.bio}</Text>
          ) : null}
          {partner.location ? (
            <Text style={[styles.meta, { color: theme.mutedForeground }]}>📍 {partner.location}</Text>
          ) : null}
          {partner.tags.length > 0 ? (
            <View style={styles.tagsWrap}>
              {partner.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.tagText, { color: theme.text }]}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {partner.prompts.length > 0 ? (
            <View style={styles.promptsWrap}>
              {partner.prompts.slice(0, 3).map((p, i) => (
                <View key={i} style={[styles.promptCard, { borderColor: theme.border }]}>
                  <Text style={[styles.promptQ, { color: theme.mutedForeground }]}>{p.question}</Text>
                  <Text style={[styles.promptA, { color: theme.text }]}>{p.answer}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius['3xl'],
    borderTopRightRadius: radius['3xl'],
    maxHeight: '85%',
    paddingTop: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    opacity: 0.3,
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,128,128,0.3)',
  },
  closeText: {
    fontSize: 18,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
  },
  heroPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    fontSize: 12,
  },
  heroInfo: {
    flex: 1,
  },
  name: {
    ...typography.titleLG,
  },
  meta: {
    ...typography.body,
    marginTop: spacing.xs,
  },
  bio: {
    ...typography.body,
    marginBottom: spacing.md,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  tag: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  tagText: {
    ...typography.caption,
  },
  promptsWrap: {
    gap: spacing.md,
  },
  promptCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  promptQ: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  promptA: {
    ...typography.body,
  },
});
