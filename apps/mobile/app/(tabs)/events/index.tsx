import { StyleSheet, Pressable, ActivityIndicator, FlatList, ListRenderItem, Image } from 'react-native';
import { Link, router } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useEvents } from '@/lib/eventsApi';
import { eventCoverUrl } from '@/lib/imageUrl';

export default function EventsListScreen() {
  const { user } = useAuth();
  const { data: events, isLoading, error, refetch } = useEvents(user?.id ?? null);

  if (isLoading && !events) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Failed to load events</Text>
        <Pressable style={styles.button} onPress={() => refetch()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!events?.length) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>No upcoming events</Text>
        <Text style={styles.emptySub}>Check back later.</Text>
      </View>
    );
  }

  const renderItem: ListRenderItem<typeof events[0]> = ({ item }) => (
    <Link href={`/events/${item.id}`} asChild>
      <Pressable style={styles.card}>
        <Image source={{ uri: eventCoverUrl(item.image) }} style={styles.cardImage} />
        <View style={styles.cardBody} lightColor="#fff" darkColor="#1a1a1a">
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardMeta}>{item.date} · {item.time}</Text>
          <Text style={styles.cardMeta}>{item.attendees} going</Text>
          {item.status === 'live' && (
            <View style={styles.liveBadge} lightColor="#22c55e" darkColor="#22c55e">
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
      </Pressable>
    </Link>
  );

  return (
    <FlatList
      data={events}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={isLoading}
      onRefresh={refetch}
      ListHeaderComponent={<Text style={styles.title}>Events</Text>}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  empty: { fontSize: 18, fontWeight: '600' },
  emptySub: { fontSize: 14, opacity: 0.8, marginTop: 8 },
  button: { backgroundColor: '#2f95dc', padding: 12, borderRadius: 8, marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { marginBottom: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e5e5' },
  cardImage: { width: '100%', height: 160, backgroundColor: '#eee' },
  cardBody: { padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardMeta: { fontSize: 12, opacity: 0.8 },
  liveBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
