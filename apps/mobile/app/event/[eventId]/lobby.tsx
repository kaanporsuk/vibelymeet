import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useEventDetails, useIsRegisteredForEvent, useEventDeck, swipe } from '@/lib/eventsApi';
import { avatarUrl } from '@/lib/imageUrl';

export default function EventLobbyScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { user } = useAuth();
  const id = eventId ?? '';

  const { data: event, isLoading: eventLoading } = useEventDetails(id);
  const { data: isRegistered } = useIsRegisteredForEvent(id, user?.id);
  const { data: profiles = [], isLoading: deckLoading, refetch: refetchDeck } = useEventDeck(id, user?.id ?? null, !!id && !!user?.id);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [processing, setProcessing] = useState(false);

  if (eventLoading && !event) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Event not found</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!user?.id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Sign in to view the lobby</Text>
      </View>
    );
  }

  if (!isRegistered) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Register for this event first</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const current = profiles[currentIndex];
  const hasCards = profiles.length > 0;

  const handleSwipe = async (swipeType: 'vibe' | 'pass' | 'super_vibe') => {
    if (!current || processing) return;
    setProcessing(true);
    try {
      const result = await swipe(id, current.profile_id, swipeType);
      if (result?.result === 'match' && result.match_id) {
        Alert.alert("It's a match!", 'You can start a video date when ready.', [
          { text: 'OK', onPress: () => refetchDeck() },
        ]);
      }
      if (result?.result === 'match_queued') {
        Alert.alert('Match queued', "You'll be notified when your partner is ready.");
      }
      setCurrentIndex((i) => Math.min(i + 1, profiles.length - 1));
      if (currentIndex + 1 >= profiles.length) refetchDeck();
    } catch {
      Alert.alert('Error', 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.subtitle}>Discover who's here</Text>

      {deckLoading && !hasCards ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : !hasCards || !current ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>No one to show right now</Text>
          <Text style={styles.emptySub}>Check back in a bit — the deck refreshes every 15s.</Text>
          <Pressable style={styles.button} onPress={() => refetchDeck()}>
            <Text style={styles.buttonText}>Refresh</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Image
              source={{ uri: avatarUrl(current.avatar_url || current.photos?.[0]) }}
              style={styles.cardImage}
            />
            <ScrollView style={styles.cardBody}>
              <Text style={styles.cardName}>{current.name}, {current.age}</Text>
              {current.tagline ? <Text style={styles.cardTagline}>{current.tagline}</Text> : null}
              {current.job ? <Text style={styles.cardMeta}>{current.job}</Text> : null}
              {current.bio ? <Text style={styles.cardBio}>{current.bio}</Text> : null}
            </ScrollView>
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.actionBtn, styles.passBtn]}
              onPress={() => handleSwipe('pass')}
              disabled={processing}
            >
              <Text style={styles.actionBtnText}>Pass</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.vibeBtn]}
              onPress={() => handleSwipe('vibe')}
              disabled={processing}
            >
              {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Vibe</Text>}
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.superBtn]}
              onPress={() => handleSwipe('super_vibe')}
              disabled={processing}
            >
              <Text style={styles.actionBtnText}>Super</Text>
            </Pressable>
          </View>
          <Text style={styles.deckMeta}>{currentIndex + 1} of {profiles.length} in deck</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 14, opacity: 0.8, marginBottom: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  empty: { fontSize: 16, fontWeight: '600' },
  emptySub: { fontSize: 12, opacity: 0.8, marginTop: 8, marginBottom: 16 },
  button: { backgroundColor: '#2f95dc', padding: 12, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e5e5', marginBottom: 16 },
  cardImage: { width: '100%', height: 320, backgroundColor: '#eee' },
  cardBody: { padding: 12, maxHeight: 120 },
  cardName: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  cardTagline: { fontSize: 14, opacity: 0.9, marginBottom: 4 },
  cardMeta: { fontSize: 12, opacity: 0.8 },
  cardBio: { fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 8 },
  actionBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  passBtn: { backgroundColor: '#6b7280' },
  vibeBtn: { backgroundColor: '#2f95dc' },
  superBtn: { backgroundColor: '#8b5cf6' },
  actionBtnText: { color: '#fff', fontWeight: '600' },
  deckMeta: { fontSize: 12, opacity: 0.7, textAlign: 'center' },
});
