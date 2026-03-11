import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ListRenderItem,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useMessages, useSendMessage, useRealtimeMessages, type ChatMessage } from '@/lib/chatApi';

export default function ChatThreadScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data, isLoading, error } = useMessages(otherUserId ?? undefined, user?.id ?? null);
  const { mutateAsync: sendMessage, isPending: sending } = useSendMessage();
  useRealtimeMessages(data?.matchId ?? null, !!data?.matchId);

  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);

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
      <View style={styles.centered}>
        <Text style={styles.error}>Invalid chat</Text>
      </View>
    );
  }

  if (isLoading && !data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Could not load conversation</Text>
      </View>
    );
  }

  if (!data.matchId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>No conversation found</Text>
      </View>
    );
  }

  const renderItem: ListRenderItem<ChatMessage> = ({ item }) => (
    <View style={[styles.bubble, item.sender === 'me' ? styles.bubbleMe : styles.bubbleThem]}>
      <Text style={[styles.bubbleText, item.sender === 'me' && styles.bubbleTextMe]}>{item.text}</Text>
      <Text style={styles.bubbleTime}>{item.time}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={data.messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hi!</Text>}
      />
      <View style={styles.footer}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendBtnText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: '#dc2626' },
  empty: { padding: 24, textAlign: 'center', opacity: 0.7 },
  list: { padding: 16, paddingBottom: 8 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: '#2f95dc' },
  bubbleThem: { alignSelf: 'flex-start', backgroundColor: '#e5e5e5' },
  bubbleText: { fontSize: 15 },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 11, opacity: 0.7, marginTop: 4 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5' },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, maxHeight: 100 },
  sendBtn: { backgroundColor: '#2f95dc', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, justifyContent: 'center', minWidth: 60 },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '600' },
});
