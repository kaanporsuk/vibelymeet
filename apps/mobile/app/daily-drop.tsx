import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useDailyDrop } from '@/lib/dailyDropApi';
import { avatarUrl } from '@/lib/imageUrl';

const OPENER_MAX = 140;

export default function DailyDropScreen() {
  const { user } = useAuth();
  const {
    drop,
    partner,
    openerSentByMe,
    openerText,
    replyText,
    chatUnlocked,
    matchId,
    partnerId,
    timeRemaining,
    isExpired,
    hasDrop,
    isLoading,
    markViewed,
    sendOpener,
    sendReply,
    passDrop,
    refetch,
  } = useDailyDrop(user?.id);

  const [openerInput, setOpenerInput] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [sending, setSending] = useState(false);

  const canSendOpener = !!drop && !drop.opener_sender_id && openerInput.trim().length > 0 && openerInput.trim().length <= OPENER_MAX;
  const canSendReply = !!drop && drop.opener_sender_id && drop.opener_sender_id !== user?.id && !chatUnlocked && replyInput.trim().length > 0;

  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!drop || !user?.id) return;
    const myRole = drop.user_a_id === user.id ? 'a' : 'b';
    const notViewed = myRole === 'a' ? !drop.user_a_viewed : !drop.user_b_viewed;
    if (notViewed && !viewedRef.current.has(drop.id)) {
      viewedRef.current.add(drop.id);
      markViewed();
    }
  }, [drop?.id, drop?.user_a_viewed, drop?.user_b_viewed, user?.id, markViewed]);

  const handleSendOpener = async () => {
    if (!canSendOpener || sending) return;
    setSending(true);
    try {
      await sendOpener(openerInput.trim());
      setOpenerInput('');
    } catch (e) {
      Alert.alert('Error', 'Could not send opener');
    } finally {
      setSending(false);
    }
  };

  const handleSendReply = async () => {
    if (!canSendReply || sending) return;
    setSending(true);
    try {
      await sendReply(replyInput.trim());
      setReplyInput('');
    } catch (e) {
      Alert.alert('Error', 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const handlePass = () => {
    Alert.alert('Pass on this drop?', "You won't be able to message this person through Daily Drop.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pass', style: 'destructive', onPress: () => passDrop() },
    ]);
  };

  if (isLoading && !drop) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!hasDrop || !drop) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Daily Drop</Text>
        <Text style={styles.empty}>No drop for today</Text>
        <Text style={styles.emptySub}>Check back tomorrow for a new match.</Text>
        <Pressable style={styles.button} onPress={() => refetch()}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  if (isExpired) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Daily Drop</Text>
        <Text style={styles.empty}>This drop has expired</Text>
        <Pressable style={styles.button} onPress={() => refetch()}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  const photo = partner?.photos?.[0] ?? partner?.avatar_url ?? '';
  const timerMins = Math.floor(timeRemaining / 60);
  const timerSecs = timeRemaining % 60;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Daily Drop</Text>
      <Text style={styles.timer}>Time left: {timerMins}:{String(timerSecs).padStart(2, '0')}</Text>

      {partner && (
        <View style={styles.card}>
          <Image source={{ uri: avatarUrl(photo) }} style={styles.avatar} />
          <Text style={styles.name}>{partner.name}, {partner.age}</Text>
          {partner.bio ? <Text style={styles.bio}>{partner.bio}</Text> : null}
        </View>
      )}

      {chatUnlocked && matchId && partnerId ? (
        <View style={styles.section}>
          <Text style={styles.status}>You're connected! Chat unlocked.</Text>
          <Link href={`/chat/${partnerId}`} asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonText}>Open chat</Text>
            </Pressable>
          </Link>
        </View>
      ) : openerText ? (
        <View style={styles.section}>
          <Text style={styles.label}>First message</Text>
          <Text style={styles.messageBubble}>{openerText}</Text>
          {replyText ? (
            <Text style={styles.messageBubbleReply}>{replyText}</Text>
          ) : !openerSentByMe && user?.id ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Reply..."
                value={replyInput}
                onChangeText={setReplyInput}
                multiline
                editable={!sending}
              />
              <Pressable style={[styles.button, (!canSendReply || sending) && styles.buttonDisabled]} onPress={handleSendReply} disabled={!canSendReply || sending}>
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send reply</Text>}
              </Pressable>
            </>
          ) : null}
        </View>
      ) : !drop.opener_sender_id ? (
        <View style={styles.section}>
          <Text style={styles.label}>Send an opener (max {OPENER_MAX} chars)</Text>
          <TextInput
            style={styles.input}
            placeholder="Say hi..."
            value={openerInput}
            onChangeText={setOpenerInput}
            maxLength={OPENER_MAX}
            multiline
            editable={!sending}
          />
          <Text style={styles.charCount}>{openerInput.length}/{OPENER_MAX}</Text>
          <Pressable style={[styles.button, (!canSendOpener || sending) && styles.buttonDisabled]} onPress={handleSendOpener} disabled={!canSendOpener || sending}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send opener</Text>}
          </Pressable>
        </View>
      ) : null}

      {!chatUnlocked && (
        <Pressable style={styles.passBtn} onPress={handlePass}>
          <Text style={styles.passBtnText}>Pass on this drop</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  timer: { fontSize: 14, opacity: 0.8, marginBottom: 16 },
  empty: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  emptySub: { fontSize: 14, opacity: 0.8, marginTop: 4 },
  card: { marginBottom: 24, alignItems: 'center' },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#eee', marginBottom: 12 },
  name: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
  bio: { fontSize: 14, opacity: 0.9, textAlign: 'center' },
  section: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  messageBubble: { backgroundColor: '#e5e5e5', padding: 12, borderRadius: 12, marginBottom: 8 },
  messageBubbleReply: { backgroundColor: '#2f95dc', padding: 12, borderRadius: 12, marginBottom: 8 },
  status: { fontSize: 16, marginBottom: 12 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 8, minHeight: 80, textAlignVertical: 'top' },
  charCount: { fontSize: 12, opacity: 0.7, marginBottom: 8 },
  button: { backgroundColor: '#2f95dc', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  passBtn: { marginTop: 16, padding: 12, alignItems: 'center' },
  passBtnText: { color: '#6b7280', fontSize: 14 },
});
