/**
 * Match celebration — shown when opening a new (unread) match from the list.
 * Params: otherUserId, name, image (optional). "Message" → chat; "Back" → matches.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function MatchCelebrationScreen() {
  const { otherUserId, name, image } = useLocalSearchParams<{ otherUserId: string; name?: string; image?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const handleMessage = () => {
    if (otherUserId) {
      router.replace({ pathname: '/chat/[id]', params: { id: otherUserId } } as any);
    }
  };

  const displayName = name ?? 'You matched!';

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top + spacing['2xl'], paddingBottom: insets.bottom + spacing['2xl'] }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>It's a match!</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>You and {displayName} like each other</Text>
        {image ? (
          <Image source={{ uri: image }} style={[styles.avatar, { borderColor: theme.tint }]} />
        ) : (
          <View style={[styles.avatarPlaceholder, { borderColor: theme.tint, backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="person" size={64} color={theme.textSecondary} />
          </View>
        )}
        <Text style={[styles.name, { color: theme.text }]}>{displayName}</Text>
      </View>
      <View style={styles.actions}>
        <VibelyButton label="Message" onPress={handleMessage} variant="primary" style={styles.btn} />
        <Pressable onPress={() => router.back()} style={styles.backWrap}>
          <Text style={[styles.backText, { color: theme.textSecondary }]}>Back to matches</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', paddingHorizontal: spacing.xl },
  content: { alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 16, marginBottom: spacing.xl },
  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, marginBottom: spacing.md },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, marginBottom: spacing.md, justifyContent: 'center', alignItems: 'center' },
  name: { fontSize: 20, fontWeight: '600' },
  actions: { gap: spacing.md },
  btn: { alignSelf: 'stretch' },
  backWrap: { alignSelf: 'center', padding: spacing.sm },
  backText: { fontSize: 15 },
});
