/**
 * Modal sheet: partner full profile via useUserProfile + UserProfileFullView (about_me, video, lifestyle, etc.).
 */
import React from 'react';
import { Modal, View, ActivityIndicator, Text, Pressable, StyleSheet, Platform, Image } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useUserProfile } from '@/lib/useUserProfile';
import { UserProfileFullView } from '@/components/profile/UserProfileFullView';
import type { PartnerProfileData } from '@/lib/videoDateApi';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  partner: PartnerProfileData;
  partnerProfileId: string;
};

export function PartnerProfileSheet({ isOpen, onClose, partner, partnerProfileId }: Props) {
  const theme = Colors[useColorScheme()];
  const userId = isOpen && partnerProfileId ? partnerProfileId : null;
  const { data: profile, isPending } = useUserProfile(userId);
  const fallbackImage = partner.avatarUrl ?? partner.photos[0] ?? null;

  if (!isOpen) return null;

  const fallbackProfile = (
    <View style={[styles.fallbackCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {fallbackImage ? (
        <Image source={{ uri: fallbackImage }} style={styles.fallbackAvatar} />
      ) : (
        <View style={[styles.fallbackAvatar, styles.fallbackAvatarEmpty, { backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.fallbackInitial, { color: theme.text }]}>
            {(partner.name || 'V').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={[styles.fallbackName, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {partner.name || 'Your date'}{partner.age ? `, ${partner.age}` : ''}
      </Text>
      {partner.location || partner.job ? (
        <Text style={[styles.fallbackMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {[partner.job, partner.location].filter(Boolean).join(' • ')}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible
      animationType="slide"
      {...(Platform.OS === 'ios' ? { presentationStyle: 'pageSheet' as const } : {})}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {!partnerProfileId ? (
          <View style={[styles.centered, { paddingHorizontal: 24 }]}>
            {fallbackProfile}
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>Profile is still loading.</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={{ color: theme.tint, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </View>
        ) : isPending && profile == null ? (
          <View style={[styles.centered, { paddingHorizontal: 24 }]}>
            {fallbackProfile}
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading full profile...</Text>
          </View>
        ) : profile == null ? (
          <View style={[styles.centered, { paddingHorizontal: 24 }]}>
            {fallbackProfile}
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>Could not load profile.</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={{ color: theme.tint, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <UserProfileFullView
            profile={profile}
            isOwnProfile={false}
            onClose={onClose}
            enableInlineHeroPhotoPaging
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fallbackCard: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    marginBottom: 18,
  },
  fallbackAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 12,
  },
  fallbackAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackInitial: {
    fontSize: 32,
    fontWeight: '800',
  },
  fallbackName: {
    maxWidth: '100%',
    fontSize: 20,
    fontWeight: '800',
  },
  fallbackMeta: {
    marginTop: 6,
    fontSize: 13,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: { textAlign: 'center', marginBottom: 16 },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 20 },
});
