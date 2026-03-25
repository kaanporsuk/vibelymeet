/**
 * Modal sheet: partner full profile via useUserProfile + UserProfileFullView (about_me, video, lifestyle, etc.).
 */
import React from 'react';
import { Modal, View, ActivityIndicator, Text, Pressable, StyleSheet, Platform } from 'react-native';
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
  void partner;
  const theme = Colors[useColorScheme()];
  const userId = isOpen && partnerProfileId ? partnerProfileId : null;
  const { data: profile, isPending } = useUserProfile(userId);

  if (!isOpen) return null;

  return (
    <Modal
      visible
      animationType="slide"
      {...(Platform.OS === 'ios' ? { presentationStyle: 'pageSheet' as const } : {})}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {!partnerProfileId ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </View>
        ) : isPending && profile == null ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </View>
        ) : profile == null ? (
          <View style={[styles.centered, { paddingHorizontal: 24 }]}>
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>Could not load profile.</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={{ color: theme.tint, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <UserProfileFullView profile={profile} isOwnProfile={false} onClose={onClose} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { textAlign: 'center', marginBottom: 16 },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 20 },
});
