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
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Video, ResizeMode } from 'expo-av';
import Colors from '@/constants/Colors';
import { GlassSurface, LoadingState, ErrorState } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useMessages,
  useSendMessage,
  useSendVoiceMessage,
  useSendChatVideoMessage,
  useRealtimeMessages,
  useMatches,
  type ChatMessage,
} from '@/lib/chatApi';

function VoiceMessageBubble({
  uri,
  duration,
  textColor,
  timeColor,
  time,
}: {
  uri: string;
  duration?: number | null;
  textColor: string;
  timeColor: string;
  time: string;
}) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const play = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.replayAsync();
        setPlaying(true);
        return;
      }
      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      await sound.playAsync();
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && !s.isPlaying) setPlaying(false);
      });
    } catch {
      setPlaying(false);
    }
  };
  useEffect(() => () => { soundRef.current?.unloadAsync(); }, []);
  return (
    <View>
      <Pressable onPress={play} style={styles.voiceRow}>
        <Ionicons name={playing ? 'pause' : 'play'} size={24} color={textColor} />
        <Text style={[styles.voiceLabel, { color: textColor }]}>
          Voice {duration != null ? `· ${duration}s` : ''}
        </Text>
      </Pressable>
      <Text style={[styles.bubbleTime, { color: timeColor }]}>{time}</Text>
    </View>
  );
}

export default function ChatThreadScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useMessages(otherUserId ?? undefined, user?.id ?? null);
  const { data: matches = [] } = useMatches(user?.id);
  const { mutateAsync: sendMessage, isPending: sending } = useSendMessage();
  const { mutateAsync: sendVoiceMessage, isPending: sendingVoice } = useSendVoiceMessage();
  const { mutateAsync: sendChatVideoMessage, isPending: sendingVideo } = useSendChatVideoMessage();
  useRealtimeMessages(data?.matchId ?? null, !!data?.matchId);

  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<InstanceType<typeof Audio.Recording> | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const isSending = sending || sendingVoice || sendingVideo;

  const otherName = otherUserId ? (matches.find((m) => m.id === otherUserId)?.name ?? 'Chat') : 'Chat';

  useEffect(() => {
    if (data?.messages?.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [data?.messages?.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !data?.matchId || isSending) return;
    setInput('');
    try {
      await sendMessage({ matchId: data.matchId, content: text });
    } catch {
      Alert.alert('Error', 'Could not send message');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
      });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = rec;
      setRecording(true);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Could not start recording');
      Alert.alert('Recording', 'Microphone access is needed for voice messages.');
    }
  };

  const stopVoiceRecordingAndSend = async () => {
    const rec = recordingRef.current;
    if (!rec || !data?.matchId || !user?.id) {
      setRecording(false);
      recordingRef.current = null;
      return;
    }
    setRecording(false);
    recordingRef.current = null;
    try {
      const status = await rec.stopAndUnloadAsync();
      const uri = rec.getURI() ?? (status as { uri?: string }).uri;
      if (!uri) throw new Error('No recording file');
      const durationSec = (status.durationMillis ?? 0) / 1000;
      await sendVoiceMessage({
        matchId: data.matchId,
        audioUri: uri,
        durationSeconds: durationSec || 1,
        currentUserId: user.id,
      });
    } catch (e) {
      Alert.alert('Voice message failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleVoicePress = async () => {
    if (recording) {
      await stopVoiceRecordingAndSend();
    } else {
      await startVoiceRecording();
    }
  };

  const handleVideoPick = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your media library to send a video.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      await sendChatVideoMessage({
        matchId: data.matchId,
        videoUri: asset.uri,
        durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
        currentUserId: user.id,
        mimeType: asset.mimeType ?? undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Video send failed';
      setVideoError(msg);
      Alert.alert('Video failed', msg);
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

  const renderItem: ListRenderItem<ChatMessage> = ({ item }) => {
    const isMe = item.sender === 'me';
    const textColor = isMe ? '#fff' : theme.text;
    const timeColor = isMe ? 'rgba(255,255,255,0.8)' : theme.textSecondary;
    return (
      <View
        style={[
          styles.bubble,
          isMe ? [styles.bubbleMe, { backgroundColor: theme.tint }] : [styles.bubbleThem, { backgroundColor: theme.surfaceSubtle }],
        ]}
      >
        {item.audio_url ? (
          <VoiceMessageBubble uri={item.audio_url} duration={item.audio_duration_seconds} textColor={textColor} timeColor={timeColor} time={item.time} />
        ) : item.video_url ? (
          <View>
            <Video
              source={{ uri: item.video_url }}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              style={styles.chatVideo}
            />
            <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
          </View>
        ) : (
          <>
            <Text style={[styles.bubbleText, { color: textColor }]}>{item.text}</Text>
            <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
          </>
        )}
      </View>
    );
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
          {otherName}
        </Text>
        <Pressable
          onPress={() => otherUserId && (router as { push: (p: string) => void }).push(`/user/${otherUserId}`)}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="View profile"
        >
          <Ionicons name="person-outline" size={22} color={theme.text} />
        </Pressable>
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
            editable={!isSending}
          />
          <Pressable
            style={[styles.voiceBtn, { backgroundColor: theme.surfaceSubtle }]}
            onPress={handleVideoPick}
            disabled={isSending}
          >
            {sendingVideo ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Ionicons name="videocam-outline" size={22} color={theme.tint} />
            )}
          </Pressable>
          <Pressable
            style={[styles.voiceBtn, { backgroundColor: theme.surfaceSubtle }]}
            onPress={handleVoicePress}
            disabled={isSending}
          >
            {sendingVoice ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Ionicons name={recording ? 'stop' : 'mic'} size={22} color={theme.tint} />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: theme.tint },
              (!input.trim() || isSending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!input.trim() || isSending}
          >
            <Text style={styles.sendBtnText}>
              {sending ? '…' : 'Send'}
            </Text>
          </Pressable>
        </View>
        {(voiceError || videoError) ? (
          <Text style={[styles.voiceError, { color: theme.danger }]}>{voiceError ?? videoError}</Text>
        ) : null}
        {recording ? (
          <Text style={[styles.recordingHint, { color: theme.textSecondary }]}>Recording… Tap mic to send</Text>
        ) : null}
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
  voiceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceLabel: { fontSize: 15 },
  chatVideo: { width: 200, height: 120, borderRadius: 8 },
  voiceError: { fontSize: 12, marginTop: 4, marginHorizontal: 8 },
  recordingHint: { fontSize: 12, marginTop: 4, marginHorizontal: 8 },
});
