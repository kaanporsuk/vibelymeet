import { StyleSheet, Pressable, ActivityIndicator, FlatList, ListRenderItem, Image, RefreshControl } from 'react-native';
import { Link } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { useMatches } from '@/lib/chatApi';

export default function MatchesListScreen() {
  const { user } = useAuth();
  const { data: matches = [], isLoading, error, refetch } = useMatches(user?.id);

  if (isLoading && !matches.length) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Failed to load matches</Text>
        <Pressable style={styles.button} onPress={() => refetch()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!matches.length) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>No matches yet</Text>
        <Text style={styles.emptySub}>When you vibe with someone at an event, they’ll show up here.</Text>
      </View>
    );
  }

  const renderItem: ListRenderItem<(typeof matches)[0]> = ({ item }) => (
    <Link href={`/chat/${item.id}`} asChild>
      <Pressable style={styles.row}>
        <Image source={{ uri: item.image }} style={styles.avatar} />
        <View style={styles.rowBody} lightColor="#fff" darkColor="#1a1a1a">
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.time}>{item.time}</Text>
          </View>
          <Text style={[styles.preview, item.unread && styles.previewUnread]} numberOfLines={1}>
            {item.lastMessage || 'New match'}
          </Text>
        </View>
        {item.unread && <View style={styles.unreadDot} />}
      </Pressable>
    </Link>
  );

  return (
    <FlatList
      data={matches}
      renderItem={renderItem}
      keyExtractor={(item) => item.matchId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      ListHeaderComponent={<Text style={styles.title}>Matches</Text>}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  empty: { fontSize: 18, fontWeight: '600' },
  emptySub: { fontSize: 14, opacity: 0.8, marginTop: 8, textAlign: 'center' },
  button: { backgroundColor: '#2f95dc', padding: 12, borderRadius: 8, marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#eee' },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 12, opacity: 0.7 },
  preview: { fontSize: 14, opacity: 0.8 },
  previewUnread: { fontWeight: '600', opacity: 1 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2f95dc', marginLeft: 8 },
});
