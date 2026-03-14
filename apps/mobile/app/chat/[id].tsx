import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ListRenderItem,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, LoadingState, ErrorState } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useMessages, useSendMessage, useRealtimeMessages, useMatches, type ChatMessage } from '@/lib/chatApi';

export default function ChatThreadScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useMessages(otherUserId ?? undefined, user?.id ?? null);
  const { data: matches = [] } = useMatches(user?.id);
  const { mutateAsync: sendMessage, isPending: sending } = useSendMessage();
  useRealtimeMessages(data?.matchId ?? null, !!data?.matchId);

  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);

  const otherName = otherUserId ? (matches.find((m) => m.id === otherUserId)?.name ?? 'Chat') : 'Chat';

  useEffect(() => {
    if (data?.messages?.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [data?.messages?.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !data?.matchId || sending) return;
    setInput('');
    try {
      await sendMessage({ matchId: data.matchId, content: text });
    } catch {
      Alert.alert('Error', 'Could not send message');
    }
  };

  if (!otherUserId || !user?.id) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Invalid chat"
          message="This conversation could not be loaded."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (isLoading && !data) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading conversation…" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Could not load conversation"
          message="Check your connection and try again."
          actionLabel="Retry"
          onActionPress={() => refetch()}
        />
      </View>
    );
  }

  if (!data.matchId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="No conversation found"
          message="This match may have been removed."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  const renderItem: ListRenderItem<ChatMessage> = ({ item }) => (
    <View
      style={[
        styles.bubble,
        item.sender === 'me'
          ? [styles.bubbleMe, { backgroundColor: theme.tint }]
          : [styles.bubbleThem, { backgroundColor: theme.surfaceSubtle }],
      ]}
    >
      <Text
        style={[
          styles.bubbleText,
          { color: item.sender === 'me' ? '#fff' : theme.text },
        ]}
      >
        {item.text}
      </Text>
      <Text style={[styles.bubbleTime, { color: item.sender === 'me' ? 'rgba(255,255,255,0.8)' : theme.textSecondary }]}>
        {item.time}
      </Text>
    </View>
  );

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
          {otherName}
        </Text>
      </GlassSurface>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={data.messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              No messages yet. Say hi!
            </Text>
          }
        />
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            placeholder="Message..."
            placeholderTextColor={theme.textSecondary}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: theme.tint },
              (!input.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
          >
            <Text style={styles.sendBtnText}>
              {sending ? '…' : 'Send'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  keyboard: { flex: 1 },
  list: { padding: 16, paddingBottom: 8 },
  empty: { padding: 24, textAlign: 'center' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  bubbleMe: { alignSelf: 'flex-end' },
  bubbleThem: { alignSelf: 'flex-start' },
  bubbleText: { fontSize: 15 },
  bubbleTime: { fontSize: 11, marginTop: 4 },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    maxHeight: 100,
  },
  sendBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    justifyContent: 'center',
    minWidth: 60,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '600' },
});
