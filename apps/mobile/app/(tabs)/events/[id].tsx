import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useEventDetails, useIsRegisteredForEvent, useRegisterForEvent } from '@/lib/eventsApi';
import { eventCoverUrl } from '@/lib/imageUrl';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: event, isLoading, error } = useEventDetails(id ?? undefined);
  const { data: isRegistered } = useIsRegisteredForEvent(id ?? undefined, user?.id);
  const { registerForEvent, unregisterFromEvent, isRegistering, isUnregistering } = useRegisterForEvent();

  if (isLoading && !event) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Event not found</Text>
        <Link href="/events" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Back to events</Text>
          </Pressable>
        </Link>
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Image source={{ uri: eventCoverUrl(event.cover_image) }} style={styles.cover} />
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.meta}>{dateStr} at {timeStr}</Text>
      <Text style={styles.meta}>{event.duration_minutes ?? 60} min · {event.current_attendees ?? 0} going</Text>
      {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

      {isRegistered ? (
        <>
          <Pressable
            style={[styles.button, styles.buttonSecondary]}
            onPress={handleUnregister}
            disabled={isUnregistering}
          >
            {isUnregistering ? <ActivityIndicator color="#333" /> : <Text style={styles.buttonTextSecondary}>Cancel registration</Text>}
          </Pressable>
          <Link href={`/event/${event.id}/lobby`} asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonText}>Open lobby</Text>
            </Pressable>
          </Link>
        </>
      ) : (
        <Pressable
          style={[styles.button, (isRegistering) && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isRegistering}
        >
          {isRegistering ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  cover: { width: '100%', height: 200, backgroundColor: '#eee', marginBottom: 16, borderRadius: 8 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  meta: { fontSize: 14, opacity: 0.8, marginBottom: 4 },
  description: { fontSize: 14, marginTop: 12, marginBottom: 24 },
  error: { color: '#dc2626', marginBottom: 12 },
  button: { backgroundColor: '#2f95dc', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#666' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonTextSecondary: { color: '#333', fontWeight: '600' },
});
