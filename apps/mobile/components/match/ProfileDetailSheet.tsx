/**
 * Full profile for a match — same content as Profile Preview via UserProfileFullView + fetchUserProfile.
 */
import React from 'react';
import { Modal, View, ActivityIndicator, Text, Pressable, StyleSheet, Platform } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useUserProfile } from '@/lib/useUserProfile';
import { UserProfileFullView } from '@/components/profile/UserProfileFullView';

export type MatchForProfile = {
  id: string;
  name: string;
  age: number;
  image: string;
};

type ProfileDetailSheetProps = {
  visible: boolean;
  onClose: () => void;
  match: MatchForProfile | null;
};

export function ProfileDetailSheet({ visible, onClose, match }: ProfileDetailSheetProps) {
  const theme = Colors[useColorScheme()];
  const userId = visible && match?.id ? match.id : null;
  const { data: profile, isPending } = useUserProfile(userId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      {...(Platform.OS === 'ios' ? { presentationStyle: 'pageSheet' as const } : {})}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {!match?.id ? (
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
