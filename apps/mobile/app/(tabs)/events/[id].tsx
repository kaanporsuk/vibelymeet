import { useLocalSearchParams, router } from 'expo-router';
import { StyleSheet, ScrollView, Pressable, Image, Alert, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, LoadingState, ErrorState, VibelyButton } from '@/components/ui';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEventDetails, useIsRegisteredForEvent, useRegisterForEvent } from '@/lib/eventsApi';
import { eventCoverUrl } from '@/lib/imageUrl';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data: event, isLoading, error } = useEventDetails(id ?? undefined);
  const { data: isRegistered } = useIsRegisteredForEvent(id ?? undefined, user?.id);
  const { registerForEvent, unregisterFromEvent, isRegistering, isUnregistering } = useRegisterForEvent();

  if (isLoading && !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading event…" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Event not found"
          message="This event may have been removed or the link is invalid."
          actionLabel="Back to events"
          onActionPress={() => router.push('/(tabs)/events')}
        />
      </View>
    );
  }

  const eventDate = new Date(event.event_date);
  const dateStr = eventDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = eventDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const handleRegister = async () => {
    const ok = await registerForEvent(event.id);
    if (!ok) Alert.alert('Error', 'Could not register');
  };

  const handleUnregister = async () => {
    const ok = await unregisterFromEvent(event.id);
    if (!ok) Alert.alert('Error', 'Could not cancel');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {event.title}
        </Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 48 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.coverWrap}>
          <Image
            source={{ uri: eventCoverUrl(event.cover_image) }}
            style={[styles.cover, { backgroundColor: theme.surfaceSubtle }]}
          />
        </View>
        <Card style={styles.infoCard}>
          <Text style={[styles.title, { color: theme.text }]}>{event.title}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {dateStr} at {timeStr}
          </Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {event.duration_minutes ?? 60} min · {event.current_attendees ?? 0} going
          </Text>
          {event.description ? (
            <Text style={[styles.description, { color: theme.textSecondary }]}>{event.description}</Text>
          ) : null}
        </Card>

        {isRegistered ? (
          <>
            <VibelyButton
              label={isUnregistering ? 'Cancelling…' : 'Cancel registration'}
              onPress={handleUnregister}
              disabled={isUnregistering}
              variant="ghost"
              style={styles.cta}
            />
            <VibelyButton
              label="Open lobby"
              variant="primary"
              onPress={() => router.push(`/event/${event.id}/lobby`)}
              style={styles.cta}
            />
          </>
        ) : (
          <VibelyButton
            label={isRegistering ? 'Registering…' : 'Register'}
            onPress={handleRegister}
            loading={isRegistering}
            disabled={isRegistering}
            variant="primary"
            style={styles.cta}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { flex: 1 },
  content: { padding: spacing.lg },
  coverWrap: { marginBottom: spacing.lg, borderRadius: radius['2xl'], overflow: 'hidden' },
  cover: {
    width: '100%',
    height: 220,
    borderRadius: radius['2xl'],
  },
  infoCard: { marginBottom: spacing.lg },
  title: { ...typography.titleLG, marginBottom: spacing.sm },
  meta: { fontSize: 14, marginBottom: 4 },
  description: { fontSize: 14, lineHeight: 20, marginTop: spacing.md },
  cta: { marginTop: spacing.md },
});
