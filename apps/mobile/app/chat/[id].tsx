import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
  Image,
  Vibration,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '@/constants/Colors';
import { LoadingState, ErrorState } from '@/components/ui';
import { spacing, radius, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useMessages,
  useSendMessage,
  useSendVoiceMessage,
  useSendChatVideoMessage,
  useRealtimeMessages,
  markMatchMessagesRead,
  useTypingBroadcast,
  useMatches,
  type ChatMessage,
  type ReactionEmoji,
} from '@/lib/chatApi';
import { useUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { useArchiveMatch } from '@/lib/useArchiveMatch';
import { useMuteMatch } from '@/lib/useMuteMatch';
import { MatchActionsSheet } from '@/components/match/MatchActionsSheet';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { ProfileDetailSheet } from '@/components/match/ProfileDetailSheet';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageStatus } from '@/components/chat/MessageStatus';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { VoiceMessagePlayer } from '@/components/chat/VoiceMessagePlayer';
import { DateSuggestionSheet, type WizardState } from '@/components/chat/DateSuggestionSheet';
import { DateSuggestionChatCard } from '@/components/chat/DateSuggestionChatCard';
import { IncomingCallOverlay } from '@/components/chat/IncomingCallOverlay';
import { ActiveCallOverlay } from '@/components/chat/ActiveCallOverlay';
import { useMatchDateSuggestions, type DateSuggestionWithRelations } from '@/lib/useDateSuggestionData';
import { useQueryClient } from '@tanstack/react-query';
import { useMatchCall } from '@/lib/useMatchCall';
import { useIsOffline } from '@/lib/useNetworkStatus';
import { avatarUrl } from '@/lib/imageUrl';
import { getChatPartnerActivityLine } from '@/lib/chatActivityStatus';
import { supabase } from '@/lib/supabase';
import { formatChatImageMessageContent, parseChatImageMessageContent } from '@/lib/chatMessageContent';
import { uploadChatImageMessage } from '@/lib/chatMediaUpload';

const WEB_APP_ORIGIN = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://vibelymeet.com';

/** No native Vibe Arcade in-app yet; Games opens web chat (authenticated session may be required). */
const GAMES_WEB_FALLBACK = true;

/** Message list + chrome background (slightly lifted from pure black). */
const CHAT_CANVAS_BG = 'hsl(240, 10%, 6%)';
const MEDIA_CARD_SIZE = Math.max(
  172,
  Math.min(206, Math.floor((Dimensions.get('window').width - layout.containerPadding * 2 - 92) * 0.95))
);

function ChatImageCard({ uri, isMine, theme }: { uri: string; isMine: boolean; theme: (typeof Colors)['light'] }) {
  const frameBorder = isMine ? 'rgba(236,72,153,0.45)' : 'rgba(255,255,255,0.16)';
  return (
    <View style={[styles.chatImageOuter, { borderColor: frameBorder }]}>
      <Image source={{ uri }} style={styles.chatImage} resizeMode="cover" accessibilityIgnoresInvertColors />
    </View>
  );
}

function ChatVideoCard({
  uri,
  durationSec,
  theme,
  isMine,
}: {
  uri: string;
  durationSec?: number | null;
  theme: (typeof Colors)['light'];
  isMine: boolean;
}) {
  const [hasError, setHasError] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') setHasError(true);
    });
    return () => sub.remove();
  }, [player]);

  if (hasError) {
    return (
      <View style={[styles.chatVideoCard, styles.chatVideoError, { borderColor: theme.border }]}>
        <Ionicons name="videocam-off-outline" size={28} color={theme.textSecondary} />
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 6 }}>Couldn't load video</Text>
      </View>
    );
  }

  const durLabel =
    durationSec != null && durationSec > 0
      ? `${Math.floor(durationSec / 60)}:${Math.floor(durationSec % 60)
          .toString()
          .padStart(2, '0')}`
      : null;

  return (
    <View
      style={[
        styles.chatVideoCardOuter,
        {
          borderColor: isMine ? 'rgba(236,72,153,0.45)' : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(236,72,153,0.08)' : 'rgba(255,255,255,0.04)',
        },
      ]}
    >
      <VideoView style={styles.chatVideoInner} player={player} nativeControls contentFit="cover" />
      {durLabel ? (
        <View style={[styles.videoDurationBadge, { backgroundColor: isMine ? 'rgba(17,17,24,0.78)' : 'rgba(0,0,0,0.65)' }]}>
          <Text style={styles.videoDurationText}>{durLabel}</Text>
        </View>
      ) : null}
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
  const queryClient = useQueryClient();
  const { mutateAsync: sendMessage, isPending: sending } = useSendMessage();
  const { mutateAsync: sendVoiceMessage, isPending: sendingVoice } = useSendVoiceMessage();
  const { mutateAsync: sendChatVideoMessage, isPending: sendingVideo } = useSendChatVideoMessage();
  useRealtimeMessages(data?.matchId ?? null, !!data?.matchId);
  const { data: dateSuggestions = [], refetch: refetchDateSuggestions } = useMatchDateSuggestions(data?.matchId);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { partnerTyping } = useTypingBroadcast(
    data?.matchId ?? null,
    user?.id ?? null,
    isTyping,
    !!data?.matchId && !!user?.id
  );
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [localReactions, setLocalReactions] = useState<Record<string, ReactionEmoji>>({});
  const [showDateSheet, setShowDateSheet] = useState(false);
  const [composerDraftId, setComposerDraftId] = useState<string | null>(null);
  const [composerDraftPayload, setComposerDraftPayload] = useState<Record<string, unknown> | null>(null);
  const [composerCounter, setComposerCounter] = useState<{
    suggestionId: string;
    previousRevision: DateSuggestionWithRelations['revisions'][0];
  } | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceRecordStartedAtRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const isSending = sending || sendingVoice || sendingVideo || sendingPhoto;
  const displayMessages = useMemo(() => {
    const msgs = data?.messages ?? [];
    const lastByRef = new Map<string, string>();
    for (const m of msgs) {
      if (m.refId && (m.messageKind === 'date_suggestion' || m.messageKind === 'date_suggestion_event')) {
        lastByRef.set(m.refId, m.id);
      }
    }
    return msgs.filter((m) => {
      if (!m.refId) return true;
      if (m.messageKind !== 'date_suggestion' && m.messageKind !== 'date_suggestion_event') return true;
      return lastByRef.get(m.refId) === m.id;
    });
  }, [data?.messages]);

  const suggestionById = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of dateSuggestions) {
      map.set(s.id, s);
    }
    return map;
  }, [dateSuggestions]);

  const openDateComposer = useCallback(
    (opts: {
      mode: 'new' | 'counter' | 'editDraft';
      draftId?: string;
      draftPayload?: Record<string, unknown> | null;
      counter?: { suggestionId: string; previousRevision: DateSuggestionWithRelations['revisions'][0] };
    }) => {
      if (opts.mode === 'counter' && opts.counter) {
        setComposerCounter({
          suggestionId: opts.counter.suggestionId,
          previousRevision: opts.counter.previousRevision,
        });
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      } else if (opts.mode === 'editDraft' && opts.draftId) {
        setComposerDraftId(opts.draftId);
        setComposerDraftPayload(opts.draftPayload ?? null);
        setComposerCounter(null);
      } else {
        setComposerCounter(null);
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      }
      setShowDateSheet(true);
    },
    []
  );

  const closeDateComposer = useCallback(() => {
    setShowDateSheet(false);
    setComposerCounter(null);
    setComposerDraftId(null);
    setComposerDraftPayload(null);
  }, []);

  const onDateSuggestionUpdated = useCallback(() => {
    void refetchDateSuggestions();
    queryClient.invalidateQueries({ queryKey: ['messages', otherUserId, user?.id] });
  }, [refetchDateSuggestions, queryClient, otherUserId, user?.id]);

  useEffect(() => {
    const mid = data?.matchId;
    if (!mid) return;
    const t = setTimeout(() => {
      markMatchMessagesRead(mid)
        .then(() => refetch())
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [data?.matchId, data?.messages?.length, refetch]);

  const {
    isRinging,
    isInCall,
    callType,
    callDuration,
    incomingCall,
    isMuted,
    isVideoOff,
    localParticipant,
    remoteParticipant,
    getTrack,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useMatchCall({
    matchId: data?.matchId ?? null,
    currentUserId: user?.id ?? null,
  });

  const isOffline = useIsOffline();

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setIsTyping(!!text.trim());
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000);
  }, []);
  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  const otherName = otherUserId ? (matches.find((m) => m.id === otherUserId)?.name ?? 'Chat') : 'Chat';
  const [showActions, setShowActions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { mutateAsync: unmatch } = useUnmatch();
  const { blockUser } = useBlockUser(user?.id);
  const { archiveMatch, unarchiveMatch } = useArchiveMatch(user?.id);
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch(user?.id);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const currentMatchRow = data?.matchId ? matches.find((m) => m.matchId === data.matchId) : null;
  const matchForActions =
    data?.matchId && otherUserId
      ? { matchId: data.matchId, id: otherUserId, name: otherName, archived_at: currentMatchRow?.archived_at ?? null }
      : null;

  useEffect(() => {
    if (displayMessages.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [displayMessages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !data?.matchId || isSending) return;
    if (isOffline) {
      Alert.alert("Can't send", 'Check your connection.');
      return;
    }
    setInput('');
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    try {
      await sendMessage({ matchId: data.matchId, content: text });
    } catch {
      Alert.alert('Error', 'Could not send message');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) throw new Error('Permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      voiceRecordStartedAtRef.current = Date.now();
      audioRecorder.record();
      setRecording(true);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Could not start recording');
      Alert.alert('Recording', 'Microphone access is needed for voice messages.');
    }
  };

  const stopVoiceRecordingAndSend = async () => {
    if (!data?.matchId || !user?.id) {
      setRecording(false);
      return;
    }
    if (isOffline) {
      setRecording(false);
      Alert.alert("Can't send", 'Check your connection.');
      return;
    }
    setRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('No recording file');
      const elapsed =
        voiceRecordStartedAtRef.current != null
          ? (Date.now() - voiceRecordStartedAtRef.current) / 1000
          : 0;
      voiceRecordStartedAtRef.current = null;
      const recAny = audioRecorder as { currentTime?: number };
      const fromRecorder = typeof recAny.currentTime === 'number' ? recAny.currentTime : 0;
      const durationSec = Math.max(1, Math.round(elapsed > 0.3 ? elapsed : fromRecorder > 0 ? fromRecorder : 1));
      await sendVoiceMessage({
        matchId: data.matchId,
        audioUri: uri,
        durationSeconds: durationSec,
        currentUserId: user.id,
      });
    } catch (e) {
      Alert.alert('Voice message failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleVoicePress = () => {
    if (recording) {
      void stopVoiceRecordingAndSend();
    } else {
      void startVoiceRecording();
    }
  };

  const pickVideoFromLibrary = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your media library to send a video.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.7,
        videoMaxDuration: 120,
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
      const msg = e instanceof Error ? e.message : 'Could not attach video.';
      setVideoError(msg);
      Alert.alert('Error', msg);
    }
  };

  /** Primary video-message flow: record with the device camera (not library-only). */
  const recordVideoWithCamera = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to record a video message.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 120,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      await sendChatVideoMessage({
        matchId: data.matchId,
        videoUri: asset.uri,
        durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
        currentUserId: user.id,
        mimeType: asset.mimeType ?? 'video/mp4',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not record video.';
      setVideoError(msg);
      Alert.alert('Video message', msg);
    }
  };

  const openVideoMessageOptions = () => {
    Alert.alert('Video message', 'Record a new clip, or choose one from your library.', [
      { text: 'Record video', onPress: () => void recordVideoWithCamera() },
      { text: 'Choose from library', onPress: () => void pickVideoFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadPhotoUriAndSend = async (uri: string, mimeType?: string | null) => {
    if (!data?.matchId || !user?.id) return;
    if (isOffline) {
      Alert.alert("Can't send", 'Check your connection.');
      return;
    }
    setSendingPhoto(true);
    try {
      const publicUrl = await uploadChatImageMessage(uri, mimeType ?? 'image/jpeg');
      await sendMessage({ matchId: data.matchId, content: formatChatImageMessageContent(publicUrl) });
    } catch (e) {
      Alert.alert('Photo', e instanceof Error ? e.message : 'Could not send photo.');
    } finally {
      setSendingPhoto(false);
    }
  };

  const pickPhotoFromLibrary = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your photos to send a picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      await uploadPhotoUriAndSend(result.assets[0].uri, result.assets[0].mimeType ?? null);
    } catch (e) {
      Alert.alert('Photo', e instanceof Error ? e.message : 'Could not send photo.');
    }
  };

  const takePhotoWithCamera = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      await uploadPhotoUriAndSend(result.assets[0].uri, result.assets[0].mimeType ?? null);
    } catch (e) {
      Alert.alert('Photo', e instanceof Error ? e.message : 'Could not send photo.');
    }
  };

  const openPhotoOptions = () => {
    Alert.alert('Send photo', undefined, [
      { text: 'Take photo', onPress: () => void takePhotoWithCamera() },
      { text: 'Choose from library', onPress: () => void pickPhotoFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openGamesWebInBrowser = async () => {
    const url = `${WEB_APP_ORIGIN}/chat/${encodeURIComponent(otherUserId ?? '')}`;
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        toolbarColor: '#0a0a0c',
        controlsColor: '#ffffff',
      });
    } catch {
      Alert.alert('Games', 'Could not open the browser. Try again.');
    }
  };

  const confirmOpenGamesWebFallback = () => {
    if (!GAMES_WEB_FALLBACK) return;
    Alert.alert(
      'Open Vibely Arcade',
      'Arcade currently runs in your browser so you get the full game experience. You can return to chat anytime.',
      [
        { text: 'Stay in chat', style: 'cancel' },
        { text: 'Open browser', onPress: () => void openGamesWebInBrowser() },
      ]
    );
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

  const otherUser = data?.otherUser ?? null;
  const otherAvatarUri = otherUser
    ? (otherUser.photos?.[0] ?? otherUser.avatar_url) ? avatarUrl(otherUser.photos?.[0] ?? otherUser.avatar_url ?? null) : null
    : otherUserId
      ? (matches.find((m) => m.id === otherUserId)?.image ?? null)
      : null;
  const lastSeenAt = otherUser?.last_seen_at ? new Date(otherUser.last_seen_at).getTime() : null;
  const activityLine = getChatPartnerActivityLine({
    partnerTyping,
    lastSeenAtMs: lastSeenAt,
  });

  const renderBubbleContent = (item: ChatMessage, textColor: string, timeColor: string, isMe: boolean) => {
    const reaction = localReactions[item.id] ?? item.reaction ?? null;
    const statusOrTime = isMe ? (
      <MessageStatus status={item.status ?? 'delivered'} time={item.time} isMyMessage />
    ) : (
      <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
    );
    if (item.audio_url) {
      return (
        <View>
          <VoiceMessagePlayer
            uri={item.audio_url}
            durationSeconds={item.audio_duration_seconds}
            isMine={isMe}
            theme={theme}
            wrapStyle={styles.voicePlayerWrap}
            footer={
              <>
                {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
                {statusOrTime}
              </>
            }
          />
        </View>
      );
    }
    if (item.video_url) {
      return (
        <View>
          <ChatVideoCard
            uri={item.video_url}
            durationSec={item.video_duration_seconds ?? null}
            theme={theme}
            isMine={isMe}
          />
          <View style={styles.mediaMetaBlock}>
            {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
            {statusOrTime}
          </View>
        </View>
      );
    }
    const imageUrl = parseChatImageMessageContent(item.text);
    if (imageUrl) {
      return (
        <View>
          <ChatImageCard uri={imageUrl} isMine={isMe} theme={theme} />
          <View style={styles.mediaMetaBlock}>
            {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
            {statusOrTime}
          </View>
        </View>
      );
    }
    return (
      <>
        <Text style={[styles.bubbleText, { color: textColor }]}>{item.text}</Text>
        {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
        {statusOrTime}
      </>
    );
  };

  const otherAge =
    otherUser?.age ?? matches.find((m) => m.id === otherUserId)?.age ?? 0;

  const renderItem: ListRenderItem<ChatMessage> = ({ item, index }) => {
    const isDateTimeline =
      item.messageKind === 'date_suggestion' || item.messageKind === 'date_suggestion_event';
    if (isDateTimeline && !item.refId) {
      return (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Date suggestion (syncing…)</Text>
        </View>
      );
    }
    if (isDateTimeline && item.refId) {
      const sug = suggestionById.get(item.refId);
      return (
        <View style={{ marginBottom: spacing.md, width: '100%' }}>
          {sug ? (
            <DateSuggestionChatCard
              suggestion={sug}
              currentUserId={user?.id ?? ''}
              partnerName={otherName}
              partnerUserId={otherUserId ?? ''}
              onOpenComposer={openDateComposer}
              onUpdated={onDateSuggestionUpdated}
            />
          ) : (
            <Text style={{ color: theme.textSecondary, fontSize: 13, paddingVertical: 8 }}>
              Loading date suggestion…
            </Text>
          )}
        </View>
      );
    }

    const isMe = item.sender === 'me';
    const messages = displayMessages;
    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const prev = index > 0 ? messages[index - 1] : null;
    const isLastInGroup = !next || next.sender !== item.sender;
    const hasVideo = !!item.video_url;
    const hasImage = !!parseChatImageMessageContent(item.text);
    const isMediaBubble = hasVideo || hasImage;
    const prevIsMedia = !!prev && (!!prev.video_url || !!parseChatImageMessageContent(prev.text));
    const nextIsMedia = !!next && (!!next.video_url || !!parseChatImageMessageContent(next.text));
    const bubbleMarginBottom = isLastInGroup
      ? spacing.md
      : isMediaBubble && nextIsMedia
        ? 1
        : isMediaBubble || prevIsMedia
          ? 4
          : 2;
    const textColor = isMe ? theme.primaryForeground : theme.text;
    const timeColor = isMe ? 'rgba(255,255,255,0.85)' : theme.textSecondary;
    const content = renderBubbleContent(item, textColor, timeColor, isMe);
    const bubbleRadiusMe = {
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 4,
    };
    const bubbleRadiusThem = {
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomLeftRadius: 4,
      borderBottomRightRadius: 18,
    };

    const bubbleBody = isMe ? (
      <LinearGradient
        colors={isMediaBubble ? ['rgba(236,72,153,0.12)', 'rgba(236,72,153,0.08)'] : [theme.tint, theme.neonPink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.bubbleGradient, bubbleRadiusMe, isMediaBubble ? styles.mediaBubbleTight : null]}
      >
        {content}
      </LinearGradient>
    ) : (
      <View
        style={[
          styles.bubbleThemInner,
          {
            backgroundColor: isMediaBubble ? 'rgba(255,255,255,0.03)' : theme.surface,
            borderColor: isMediaBubble ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
          },
          bubbleRadiusThem,
          isMediaBubble ? styles.mediaBubbleTight : null,
        ]}
      >
        {content}
      </View>
    );

    const bubblePress = (
      <Pressable
        onLongPress={() => {
          Vibration.vibrate(30);
          setReactionPickerMessageId(item.id);
        }}
        delayLongPress={400}
        style={({ pressed }) => [
          styles.bubble,
          { marginBottom: 0, opacity: pressed ? 0.92 : 1 },
        ]}
      >
        {bubbleBody}
      </Pressable>
    );

    if (isMe) {
      return (
        <View style={[styles.rowMe, { marginBottom: bubbleMarginBottom }]}>
          <View style={styles.bubbleMeWrap}>{bubblePress}</View>
        </View>
      );
    }

    const avatarSlot =
      isLastInGroup && otherAvatarUri ? (
        <Image source={{ uri: otherAvatarUri }} style={styles.themAvatar} />
      ) : isLastInGroup ? (
        <View style={[styles.themAvatar, styles.themAvatarPlaceholder, { backgroundColor: theme.muted }]}>
          <Text style={[styles.themAvatarFallback, { color: theme.textSecondary }]}>{otherName?.[0] ?? '?'}</Text>
        </View>
      ) : (
        <View style={styles.themAvatarSpacer} />
      );

    return (
      <View style={[styles.themRow, { marginBottom: bubbleMarginBottom }]}>
        <View style={styles.themAvatarColumn}>{avatarSlot}</View>
        <View style={styles.themBubbleColumn}>{bubblePress}</View>
      </View>
    );
  };

  const activityColor =
    activityLine?.variant === 'online'
      ? theme.success
      : activityLine?.variant === 'typing'
        ? theme.tint
        : theme.textSecondary;

  return (
    <View style={[styles.container, { backgroundColor: CHAT_CANVAS_BG }]}>
      <View style={[styles.headerOuter, { paddingTop: insets.top, backgroundColor: CHAT_CANVAS_BG }]}>
        <View style={[styles.headerCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={22} color={theme.text} />
            </Pressable>
            <Pressable
              onPress={() => setShowProfileSheet(true)}
              style={({ pressed }) => [styles.headerCenter, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="View profile"
            >
              {otherAvatarUri ? (
                <Image source={{ uri: otherAvatarUri }} style={styles.headerAvatar} />
              ) : (
                <View style={[styles.headerAvatar, styles.headerAvatarFallback, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.headerAvatarLetter, { color: theme.textSecondary }]}>{otherName?.[0] ?? '?'}</Text>
                </View>
              )}
              <View style={styles.headerTextWrap}>
                <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                  {otherName}
                  {otherAge > 0 ? `, ${otherAge}` : ''}
                </Text>
                {activityLine ? (
                  <Text style={[styles.headerSubtitle, { color: activityColor }]} numberOfLines={1}>
                    {activityLine.text}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <View style={styles.headerRightRow}>
              <Pressable
                onPress={() => {
                  if (isOffline) {
                    Alert.alert("Can't start a call", 'Check your connection.');
                    return;
                  }
                  if (data?.matchId) startCall('voice');
                }}
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityLabel="Voice call"
              >
                <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  if (isOffline) {
                    Alert.alert("Can't start a call", 'Check your connection.');
                    return;
                  }
                  if (data?.matchId) startCall('video');
                }}
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityLabel="Video call"
              >
                <Ionicons name="videocam-outline" size={20} color={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => setShowActions(true)}
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityLabel="More actions"
              >
                <Ionicons name="ellipsis-horizontal" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
          </View>
      </View>

      <ProfileDetailSheet
        visible={showProfileSheet}
        onClose={() => setShowProfileSheet(false)}
        match={
          otherUserId && (otherUser || matches.find((m) => m.id === otherUserId))
            ? {
                id: otherUserId,
                name: otherUser?.name ?? otherName,
                age: otherUser?.age ?? matches.find((m) => m.id === otherUserId)?.age ?? 0,
                image: otherAvatarUri ?? '',
              }
            : null
        }
      />

      {incomingCall && (
        <IncomingCallOverlay
          incomingCall={incomingCall}
          callerAvatarUri={incomingCall.callerId === otherUserId ? otherAvatarUri : null}
          onAnswer={acceptCall}
          onDecline={declineCall}
        />
      )}

      <ActiveCallOverlay
        visible={isRinging || isInCall}
        isRinging={isRinging}
        isInCall={isInCall}
        callType={callType}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        callDuration={callDuration}
        partnerName={otherName}
        partnerAvatarUri={otherAvatarUri}
        localParticipant={localParticipant}
        remoteParticipant={remoteParticipant}
        getTrack={getTrack}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onEndCall={endCall}
      />

      {matchForActions && (
        <>
          <MatchActionsSheet
            visible={showActions}
            onClose={() => setShowActions(false)}
            matchName={matchForActions.name}
            onViewProfile={() => {
              setShowActions(false);
              setShowProfileSheet(true);
            }}
            isArchived={!!matchForActions.archived_at}
            isMuted={isMatchMuted(matchForActions.matchId)}
            onUnarchive={async () => {
              setActionLoading('unarchive');
              try {
                await unarchiveMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onUnmatch={() => {
              Alert.alert('Unmatch?', `Remove ${matchForActions.name} from your matches? This cannot be undone.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unmatch',
                  style: 'destructive',
                  onPress: async () => {
                    setActionLoading('unmatch');
                    try {
                      await unmatch({ matchId: matchForActions.matchId });
                      setShowActions(false);
                      router.back();
                    } finally {
                      setActionLoading(null);
                    }
                  },
                },
              ]);
            }}
            onArchive={async () => {
              setActionLoading('archive');
              try {
                await archiveMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onBlock={() => {
              Alert.alert('Block?', `Block ${matchForActions.name}? They won't be able to contact you.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    setActionLoading('block');
                    try {
                      await blockUser({ blockedId: matchForActions.id, matchId: matchForActions.matchId });
                      setShowActions(false);
                      router.back();
                    } finally {
                      setActionLoading(null);
                    }
                  },
                },
              ]);
            }}
            onMute={async () => {
              setActionLoading('mute');
              try {
                await muteMatch({ matchId: matchForActions.matchId, duration: '1day' });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onUnmute={async () => {
              setActionLoading('unmute');
              try {
                await unmuteMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onReport={() => {
              setShowActions(false);
              setShowReport(true);
            }}
            loading={actionLoading}
          />
          <ReportFlowModal
            visible={showReport}
            onClose={() => setShowReport(false)}
            onSuccess={() => setShowReport(false)}
            reportedId={matchForActions.id}
            reportedName={matchForActions.name}
            reporterId={user?.id ?? ''}
          />
        </>
      )}

      <KeyboardAvoidingView
        style={[styles.keyboard, { backgroundColor: CHAT_CANVAS_BG }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <FlatList
          ref={listRef}
          data={displayMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          style={styles.messageList}
          contentContainerStyle={[
            styles.list,
            displayMessages.length === 0 ? styles.listContentEmpty : null,
          ]}
          ListEmptyComponent={
            <View style={styles.waveEmptyWrap}>
              <Text style={styles.waveEmptyEmoji}>👋</Text>
              <Text style={[styles.waveEmptyTitle, { color: theme.text }]}>{"It's a match!"}</Text>
              <Text style={[styles.waveEmptySub, { color: theme.textSecondary }]}>
                Send a wave to start the conversation
              </Text>
            </View>
          }
          ListFooterComponent={
            partnerTyping ? (
              <View style={styles.typingWrap}>
                <TypingIndicator />
              </View>
            ) : null
          }
        />
        <View style={[styles.contextualRow, { borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: CHAT_CANVAS_BG }]}>
          <Pressable
            onPress={() => openDateComposer({ mode: 'new' })}
            style={({ pressed }) => [
              styles.contextChip,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Suggest a date"
          >
            <Ionicons name="calendar-outline" size={16} color={theme.tint} />
            <Text numberOfLines={1} style={[styles.contextChipLabel, { color: theme.text }]}>Suggest a Date</Text>
          </Pressable>
          <Pressable
            onPress={() => confirmOpenGamesWebFallback()}
            style={({ pressed }) => [
              styles.contextChip,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Games"
          >
            <Ionicons name="game-controller-outline" size={16} color={theme.neonCyan} />
            <Text numberOfLines={1} style={[styles.contextChipLabel, { color: theme.text }]}>Games</Text>
          </Pressable>
        </View>
        <View
          style={[
            styles.composerDock,
            {
              borderTopColor: 'rgba(255,255,255,0.06)',
              backgroundColor: 'hsl(240, 10%, 8%)',
              paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, spacing.sm) : spacing.md,
            },
          ]}
        >
          <Pressable
            style={[styles.composerIconBtn, { backgroundColor: theme.muted }]}
            onPress={() => openPhotoOptions()}
            disabled={isSending}
            accessibilityLabel="Photo"
          >
            {sendingPhoto ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Ionicons name="camera-outline" size={20} color={theme.textSecondary} />
            )}
          </Pressable>
          <Pressable
            style={[styles.composerIconBtn, { backgroundColor: theme.muted }]}
            onPress={() => openVideoMessageOptions()}
            disabled={isSending}
            accessibilityLabel="Video message: record or choose from library"
          >
            {sendingVideo ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Ionicons name="videocam-outline" size={20} color={theme.textSecondary} />
            )}
          </Pressable>
          <TextInput
            style={[
              styles.inputDock,
              {
                borderColor: 'rgba(255,255,255,0.08)',
                color: theme.text,
                backgroundColor: theme.surface,
              },
            ]}
            placeholder="Message…"
            placeholderTextColor={theme.textSecondary}
            value={input}
            onChangeText={handleInputChange}
            multiline
            maxLength={2000}
            editable={!isSending}
          />
          <Pressable
            style={[styles.composerIconBtn, { backgroundColor: recording ? theme.dangerSoft : theme.muted }]}
            onPress={handleVoicePress}
            disabled={isSending && !recording}
            accessibilityLabel="Voice message"
          >
            {sendingVoice ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : recording ? (
              <Ionicons name="stop" size={20} color={theme.danger} />
            ) : (
              <Ionicons name="mic-outline" size={20} color={theme.textSecondary} />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.sendFab,
              { backgroundColor: theme.tint },
              (!input.trim() || isSending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!input.trim() || isSending}
            accessibilityLabel="Send message"
          >
            <Ionicons name="arrow-up" size={22} color={theme.primaryForeground} />
          </Pressable>
        </View>
        {(voiceError || videoError) ? (
          <Text style={[styles.voiceError, { color: theme.danger }]}>{voiceError ?? videoError}</Text>
        ) : null}
        {recording ? (
          <Text style={[styles.recordingHint, { color: theme.textSecondary }]}>Recording… Tap mic to send</Text>
        ) : null}
      </KeyboardAvoidingView>

      <ReactionPicker
        visible={!!reactionPickerMessageId}
        onClose={() => setReactionPickerMessageId(null)}
        onSelect={(emoji) => {
          if (reactionPickerMessageId) {
            setLocalReactions((prev) => ({ ...prev, [reactionPickerMessageId]: emoji }));
            setReactionPickerMessageId(null);
          }
        }}
        anchorRight={
          !!reactionPickerMessageId &&
          (displayMessages.find((m) => m.id === reactionPickerMessageId)?.sender === 'me')
        }
      />

      {data?.matchId && user?.id && otherUserId ? (
        <DateSuggestionSheet
          visible={showDateSheet}
          onClose={closeDateComposer}
          matchId={data.matchId}
          currentUserId={user.id}
          partnerUserId={otherUserId}
          partnerName={otherName}
          draftSuggestionId={composerDraftId}
          draftFromParent={
            composerDraftPayload &&
            typeof composerDraftPayload === 'object' &&
            ('wizard' in composerDraftPayload || 'step' in composerDraftPayload)
              ? {
                  wizard: (composerDraftPayload as { wizard?: Partial<WizardState> }).wizard,
                  step: (composerDraftPayload as { step?: number }).step,
                }
              : null
          }
          counterContext={
            composerCounter
              ? {
                  suggestionId: composerCounter.suggestionId,
                  previousRevision: composerCounter.previousRevision,
                }
              : null
          }
          onSuccess={() => {
            void refetchDateSuggestions();
            queryClient.invalidateQueries({ queryKey: ['messages', otherUserId, user.id] });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headerOuter: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  backBtn: { padding: spacing.xs },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerIconBtn: {
    padding: 8,
    borderRadius: 12,
    minWidth: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerAvatarLetter: { fontSize: 16, fontWeight: '600' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, marginTop: 2, opacity: 0.95 },
  typingWrap: { paddingVertical: spacing.sm },
  reactionBadge: { fontSize: 14, marginTop: 4 },
  mediaMetaBlock: { marginTop: 6 },
  proposalBanners: { marginBottom: spacing.md, gap: spacing.sm },
  proposalBanner: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  proposalBannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  proposalBannerMeta: { fontSize: 13, lineHeight: 18 },
  proposalBannerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  proposalBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center' },
  proposalBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  proposalBtnLabelLight: { color: '#fff', fontWeight: '600', fontSize: 15 },
  proposalBtnLabel: { fontWeight: '600', fontSize: 15 },
  keyboard: { flex: 1 },
  messageList: { flex: 1 },
  list: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  waveEmptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    minHeight: 220,
  },
  waveEmptyEmoji: { fontSize: 48, marginBottom: 16 },
  waveEmptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  waveEmptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  empty: { padding: spacing.xl, textAlign: 'center', fontSize: 14 },
  rowMe: { alignItems: 'flex-end', width: '100%' },
  bubbleMeWrap: { maxWidth: '88%', minWidth: 0 },
  themRow: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', gap: 8 },
  themAvatarColumn: { width: 32, alignItems: 'center' },
  themAvatarSpacer: { width: 28, height: 28 },
  themBubbleColumn: { flex: 1, maxWidth: '88%', minWidth: 0 },
  themAvatar: { width: 28, height: 28, borderRadius: 14 },
  themAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  themAvatarFallback: { fontSize: 12, fontWeight: '600' },
  bubble: {
    overflow: 'hidden',
    padding: 0,
  },
  bubbleGradient: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  mediaBubbleTight: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  bubbleThemInner: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTime: { fontSize: 10, marginTop: 6, opacity: 0.85 },
  contextualRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.containerPadding,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
    minWidth: 0,
  },
  contextChipLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  composerDock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputDock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    maxHeight: 120,
    minHeight: 40,
    fontSize: 15,
  },
  sendFab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
  voicePlayerWrap: { minWidth: 0, width: '100%', maxWidth: MEDIA_CARD_SIZE + 14 },
  chatVideoCardOuter: {
    width: MEDIA_CARD_SIZE,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  chatVideoInner: { width: MEDIA_CARD_SIZE, height: Math.round(MEDIA_CARD_SIZE * 0.66) },
  chatVideoCard: { width: MEDIA_CARD_SIZE, height: Math.round(MEDIA_CARD_SIZE * 0.66) },
  chatVideoError: { alignItems: 'center', justifyContent: 'center' },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  videoDurationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  chatImageOuter: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: MEDIA_CARD_SIZE + 12,
  },
  chatImage: { width: MEDIA_CARD_SIZE, height: MEDIA_CARD_SIZE, backgroundColor: 'rgba(0,0,0,0.2)' },
  voiceError: { fontSize: 12, marginTop: 4, marginHorizontal: layout.containerPadding },
  recordingHint: { fontSize: 12, marginTop: 4, marginHorizontal: layout.containerPadding },
});
