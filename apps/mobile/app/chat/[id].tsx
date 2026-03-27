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
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useMessages,
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
import { ActiveDateSuggestionWarningModal } from '@/components/chat/ActiveDateSuggestionWarningModal';
import { CharadesStartSheet } from '@/components/chat/games/CharadesStartSheet';
import { GameSessionBubble } from '@/components/chat/games/GameSessionBubble';
import { IntuitionStartSheet } from '@/components/chat/games/IntuitionStartSheet';
import { RouletteStartSheet } from '@/components/chat/games/RouletteStartSheet';
import { ScavengerStartSheet } from '@/components/chat/games/ScavengerStartSheet';
import { TwoTruthsStartSheet } from '@/components/chat/games/TwoTruthsStartSheet';
import { WouldRatherStartSheet } from '@/components/chat/games/WouldRatherStartSheet';
import { GamesPickerSheet, type GamesPickerGameId } from '@/components/chat/games/GamesPickerSheet';
import { IncomingCallOverlay } from '@/components/chat/IncomingCallOverlay';
import { ActiveCallOverlay } from '@/components/chat/ActiveCallOverlay';
import { useMatchDateSuggestions, type DateSuggestionWithRelations } from '@/lib/useDateSuggestionData';
import { useQueryClient } from '@tanstack/react-query';
import { useMatchCall } from '@/lib/useMatchCall';
import { useIsOffline } from '@/lib/useNetworkStatus';
import { avatarUrl } from '@/lib/imageUrl';
import { getChatPartnerActivityLine } from '@/lib/chatActivityStatus';
import { supabase } from '@/lib/supabase';
import { inferChatMediaRenderKind, parseChatImageMessageContent } from '@/lib/chatMessageContent';
import { extractVibeClipMeta } from '../../../../shared/chat/messageRouting';
import { VibeClipCard } from '@/components/chat/VibeClipCard';
import { dedupeLatestByRefId } from '../../../../shared/chat/refDedupe';
import { useChatOutbox } from '@/lib/chatOutbox/ChatOutboxContext';
import type { ChatOutboxItem, ChatOutboxQueueState } from '@/lib/chatOutbox/types';
import { copyUriToChatOutboxCache, extForPayload } from '@/lib/chatOutbox/mediaCache';
import { matchHasOpenDateSuggestion } from '../../../../shared/dateSuggestions/openStatus';

const WEB_APP_ORIGIN = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://vibelymeet.com';

/** When true, Games chip includes "Open in browser" alongside native game starts. */
const GAMES_WEB_FALLBACK = true;

/** Message list + chrome background (slightly lifted from pure black). */
const CHAT_CANVAS_BG = 'hsl(240, 10%, 6%)';
const MEDIA_CARD_SIZE = Math.max(
  172,
  Math.min(206, Math.floor((Dimensions.get('window').width - layout.containerPadding * 2 - 92) * 0.95))
);
const MEDIA_CARD_MIN_WIDTH = 164;

type LocalMediaSendPayload =
  | { kind: 'image'; uri: string; mimeType: string }
  | { kind: 'voice'; uri: string; durationSeconds: number }
  | { kind: 'video'; uri: string; durationSeconds: number; mimeType?: string };

type LocalMediaSendState = 'sending' | 'failed' | 'sent';

type LocalMediaMeta = {
  localId: string;
  createdAtMs: number;
  state: LocalMediaSendState;
  payload: LocalMediaSendPayload;
  errorMessage?: string;
  serverMessageId?: string;
  /** When row is driven by durable outbox */
  outboxItemId?: string;
  outboxPhase?: ChatOutboxQueueState;
};

type LocalMediaChatMessage = ChatMessage & { localMedia: LocalMediaMeta };
type LocalTextSendState = 'sending' | 'failed' | 'sent';

type LocalTextMeta = {
  localId: string;
  createdAtMs: number;
  state: LocalTextSendState;
  payload: { text: string };
  errorMessage?: string;
  serverMessageId?: string;
  outboxItemId?: string;
  outboxPhase?: ChatOutboxQueueState;
};

type LocalTextChatMessage = ChatMessage & { localText: LocalTextMeta };
type ThreadMessage = ChatMessage | LocalMediaChatMessage | LocalTextChatMessage;

function isLocalMediaMessage(message: ThreadMessage): message is LocalMediaChatMessage {
  return typeof message === 'object' && message !== null && 'localMedia' in message;
}

function isLocalTextMessage(message: ThreadMessage): message is LocalTextChatMessage {
  return typeof message === 'object' && message !== null && 'localText' in message;
}

function mapOutboxToLocalSendState(state: ChatOutboxQueueState): LocalTextSendState | LocalMediaSendState {
  if (state === 'failed') return 'failed';
  return 'sending';
}

function outboxFooterPrimaryLabel(phase: ChatOutboxQueueState | undefined, payloadKind?: string): string | null {
  if (!phase) return null;
  const isClip = payloadKind === 'video';
  if (phase === 'queued') return isClip ? 'Clip queued…' : 'Queued…';
  if (phase === 'waiting_for_network') return 'Waiting for network…';
  if (phase === 'sending' || phase === 'awaiting_hydration') return isClip ? 'Sending Vibe Clip…' : 'Sending…';
  if (phase === 'failed') return isClip ? 'Clip failed to send' : 'Failed to send';
  return null;
}

function outboxItemToThreadMessage(item: ChatOutboxItem): ThreadMessage {
  const id = `outbox-${item.id}`;
  const time = new Date(item.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ls = mapOutboxToLocalSendState(item.state);
  const phase = item.state;
  const baseMeta = {
    outboxItemId: item.id,
    outboxPhase: phase,
    errorMessage: item.lastError,
    serverMessageId: item.serverMessageId,
  };

  if (item.payload.kind === 'text') {
    const localText: LocalTextMeta = {
      localId: id,
      createdAtMs: item.createdAtMs,
      state: ls as LocalTextSendState,
      payload: { text: item.payload.text },
      ...baseMeta,
    };
    return {
      id,
      text: item.payload.text,
      sender: 'me',
      time,
      sortAtMs: item.createdAtMs,
      status: 'sending',
      localText,
    };
  }

  const p = item.payload;
  const localMedia: LocalMediaMeta = {
    localId: id,
    createdAtMs: item.createdAtMs,
    state: ls as LocalMediaSendState,
    payload: p,
    ...baseMeta,
  };

  if (p.kind === 'voice') {
    return {
      id,
      text: '🎤 Voice message',
      sender: 'me',
      time,
      sortAtMs: item.createdAtMs,
      status: 'sending',
      audio_url: p.uri,
      audio_duration_seconds: Math.round(p.durationSeconds),
      localMedia,
    };
  }
  if (p.kind === 'video') {
    return {
      id,
      text: '🎬 Vibe Clip',
      sender: 'me',
      time,
      sortAtMs: item.createdAtMs,
      status: 'sending',
      video_url: p.uri,
      video_duration_seconds: Math.round(p.durationSeconds),
      messageKind: 'vibe_clip' as const,
      localMedia,
    };
  }
  return {
    id,
    text: 'Photo',
    sender: 'me',
    time,
    sortAtMs: item.createdAtMs,
    status: 'sending',
    localMedia,
  };
}

function threadSortKey(m: ThreadMessage): number {
  if (isLocalTextMessage(m)) return m.localText.createdAtMs;
  if (isLocalMediaMessage(m)) return m.localMedia.createdAtMs;
  return m.sortAtMs ?? 0;
}

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
  const [isReady, setIsReady] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        setHasError(true);
        return;
      }
      if (payload.status === 'readyToPlay') {
        setIsReady(true);
      }
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
      {!isReady ? (
        <View style={styles.chatVideoFallback}>
          <Ionicons name="play-circle-outline" size={34} color="rgba(255,255,255,0.86)" />
          <Text style={styles.chatVideoFallbackLabel}>Video</Text>
        </View>
      ) : null}
      {durLabel ? (
        <View style={[styles.videoDurationBadge, { backgroundColor: isMine ? 'rgba(17,17,24,0.78)' : 'rgba(0,0,0,0.65)' }]}>
          <Text numberOfLines={1} style={styles.videoDurationText}>{durLabel}</Text>
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
  const { enqueue, retry, remove, itemsForMatch, reconcileWithServerIds } = useChatOutbox();
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
  const [reactionHintShown, setReactionHintShown] = useState(false);
  const [showDateSheet, setShowDateSheet] = useState(false);
  const [showCharadesStart, setShowCharadesStart] = useState(false);
  const [showIntuitionStart, setShowIntuitionStart] = useState(false);
  const [showRouletteStart, setShowRouletteStart] = useState(false);
  const [showScavengerStart, setShowScavengerStart] = useState(false);
  const [showTwoTruthsStart, setShowTwoTruthsStart] = useState(false);
  const [showWouldRatherStart, setShowWouldRatherStart] = useState(false);
  const [showGamesPicker, setShowGamesPicker] = useState(false);
  const [showActiveDateSuggestionWarning, setShowActiveDateSuggestionWarning] = useState(false);
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
  const [voiceReplyHint, setVoiceReplyHint] = useState(false);
  const listRef = useRef<FlatList>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  const outboxForMatch = useMemo(() => {
    if (!data?.matchId) return [];
    return itemsForMatch(data.matchId);
  }, [data?.matchId, itemsForMatch]);

  useEffect(() => {
    const ids = new Set((data?.messages ?? []).map((m) => m.id));
    reconcileWithServerIds(ids);
  }, [data?.messages, reconcileWithServerIds]);

  const outboxThreadMessages = useMemo<ThreadMessage[]>(
    () => outboxForMatch.map(outboxItemToThreadMessage),
    [outboxForMatch]
  );

  const threadMessages = useMemo<ThreadMessage[]>(() => {
    const server = data?.messages ?? [];
    const merged = [...server, ...outboxThreadMessages];
    return merged.sort((a, b) => threadSortKey(a) - threadSortKey(b));
  }, [data?.messages, outboxThreadMessages]);

  const outboxBusy = useMemo(
    () => outboxForMatch.some((i) => i.state === 'sending'),
    [outboxForMatch]
  );
  const sendingVideo = useMemo(
    () => outboxForMatch.some((i) => i.state === 'sending' && i.payload.kind === 'video'),
    [outboxForMatch]
  );
  const sendingVoice = useMemo(
    () => outboxForMatch.some((i) => i.state === 'sending' && i.payload.kind === 'voice'),
    [outboxForMatch]
  );
  const isSending = sendingPhoto || outboxBusy || recording;

  const displayMessages = useMemo(() => {
    return dedupeLatestByRefId<ThreadMessage>(threadMessages, {
      isDedupeCandidate: (m) => m.messageKind === 'date_suggestion' || m.messageKind === 'date_suggestion_event',
      getRefId: (m) => m.refId,
      getId: (m) => m.id,
    });
  }, [threadMessages]);

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
        if (matchHasOpenDateSuggestion(dateSuggestions)) {
          setShowActiveDateSuggestionWarning(true);
          return;
        }
        setComposerCounter(null);
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      }
      setShowDateSheet(true);
    },
    [dateSuggestions]
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

  const handleSend = () => {
    const text = input.trim();
    if (!text || !data?.matchId || !user?.id || isSending) return;
    void enqueue({
      matchId: data.matchId,
      otherUserId: otherUserId ?? '',
      payload: { kind: 'text', text },
    });
    setInput('');
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
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
      const stable = await copyUriToChatOutboxCache(uri, extForPayload('voice'));
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: { kind: 'voice', uri: stable, durationSeconds: durationSec },
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

  const armVoiceReply = () => {
    listRef.current?.scrollToEnd({ animated: true });
    setVoiceReplyHint(true);
    setTimeout(() => setVoiceReplyHint(false), 2200);
  };

  const pickVideoFromLibrary = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your media library to send a Vibe Clip.');
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
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? undefined));
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
          mimeType: asset.mimeType ?? undefined,
        },
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
        Alert.alert('Permission needed', 'Allow camera access to record a Vibe Clip.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 120,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? 'video/mp4'));
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
          mimeType: asset.mimeType ?? 'video/mp4',
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not record video.';
      setVideoError(msg);
      Alert.alert('Video message', msg);
    }
  };

  const openVideoMessageOptions = () => {
    Alert.alert('Vibe Clip', 'Record a clip or choose one to send.', [
      { text: 'Record a Vibe Clip', onPress: () => void recordVideoWithCamera() },
      { text: 'Choose from library', onPress: () => void pickVideoFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadPhotoUriAndSend = async (uri: string, mimeType?: string | null) => {
    if (!data?.matchId || !user?.id) return;
    try {
      setSendingPhoto(true);
      const ext = extForPayload('image', mimeType ?? undefined);
      const stable = await copyUriToChatOutboxCache(uri, ext);
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: { kind: 'image', uri: stable, mimeType: mimeType ?? 'image/jpeg' },
      });
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

  const openTwoTruthsStart = () => {
    setShowCharadesStart(false);
    setShowIntuitionStart(false);
    setShowRouletteStart(false);
    setShowScavengerStart(false);
    setShowWouldRatherStart(false);
    setShowTwoTruthsStart(true);
  };

  const openWouldRatherStart = () => {
    setShowCharadesStart(false);
    setShowIntuitionStart(false);
    setShowRouletteStart(false);
    setShowScavengerStart(false);
    setShowTwoTruthsStart(false);
    setShowWouldRatherStart(true);
  };

  const openIntuitionStart = () => {
    setShowCharadesStart(false);
    setShowRouletteStart(false);
    setShowScavengerStart(false);
    setShowTwoTruthsStart(false);
    setShowWouldRatherStart(false);
    setShowIntuitionStart(true);
  };

  const openRouletteStart = () => {
    setShowCharadesStart(false);
    setShowIntuitionStart(false);
    setShowScavengerStart(false);
    setShowTwoTruthsStart(false);
    setShowWouldRatherStart(false);
    setShowRouletteStart(true);
  };

  const openCharadesStart = () => {
    setShowIntuitionStart(false);
    setShowRouletteStart(false);
    setShowScavengerStart(false);
    setShowTwoTruthsStart(false);
    setShowWouldRatherStart(false);
    setShowCharadesStart(true);
  };

  const openScavengerStart = () => {
    setShowCharadesStart(false);
    setShowIntuitionStart(false);
    setShowRouletteStart(false);
    setShowTwoTruthsStart(false);
    setShowWouldRatherStart(false);
    setShowScavengerStart(true);
  };

  const openGamesEntry = () => {
    setShowGamesPicker(true);
  };

  const handleGamesPickerSelect = (game: GamesPickerGameId) => {
    setShowGamesPicker(false);
    requestAnimationFrame(() => {
      switch (game) {
        case 'intuition':
          openIntuitionStart();
          break;
        case 'two_truths':
          openTwoTruthsStart();
          break;
        case 'would_rather':
          openWouldRatherStart();
          break;
        case 'roulette':
          openRouletteStart();
          break;
        case 'charades':
          openCharadesStart();
          break;
        case 'scavenger':
          openScavengerStart();
          break;
      }
    });
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

  const renderBubbleContent = (item: ThreadMessage, textColor: string, timeColor: string, isMe: boolean) => {
    const reaction = localReactions[item.id] ?? item.reaction ?? null;
    const localMedia = isLocalMediaMessage(item) ? item.localMedia : null;
    const localText = isLocalTextMessage(item) ? item.localText : null;
    const mediaKind = inferChatMediaRenderKind({
      content: item.text,
      audioUrl: item.audio_url,
      videoUrl: item.video_url,
      messageKind: item.messageKind,
    });
    const localSendState = localMedia?.state ?? localText?.state ?? null;
    const outboxPhase = localMedia?.outboxPhase ?? localText?.outboxPhase;
    const outboxItemId = localMedia?.outboxItemId ?? localText?.outboxItemId;
    const outboxPayloadKind = localMedia?.payload.kind ?? (localText ? 'text' : undefined);
    const outboxPrimary =
      outboxFooterPrimaryLabel(outboxPhase, outboxPayloadKind) ??
      (localSendState === 'sending'
        ? 'Sending…'
        : localSendState === 'failed'
          ? 'Failed to send'
          : item.time);
    const outboxSendingLocked =
      outboxPhase === 'sending' || outboxPhase === 'awaiting_hydration';
    const localSendFooter = isMe && localSendState ? (
      <View style={[styles.localSendRow, localSendState === 'failed' ? styles.localSendRowFailed : null]}>
        <Text style={[styles.localSendText, { color: localSendState === 'failed' ? theme.danger : timeColor }]}>
          {outboxPrimary}
        </Text>
        {localSendState === 'failed' && outboxItemId ? (
          <View style={styles.localSendActionsRow}>
            <Pressable
              onPress={() => retry(outboxItemId)}
              disabled={outboxSendingLocked}
              style={({ pressed }) => [styles.retryActionBtn, pressed ? { opacity: 0.75 } : null]}
            >
              <Text style={[styles.retryActionText, { color: theme.tint }]}>
                {outboxSendingLocked ? 'Retrying…' : 'Retry'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => remove(outboxItemId)}
              style={({ pressed }) => [styles.retryActionBtn, pressed ? { opacity: 0.75 } : null]}
            >
              <Text style={[styles.retryActionText, { color: theme.textSecondary }]}>Remove</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ) : null;
    const statusOrTime = isMe ? (
      localSendFooter ?? <MessageStatus status={item.status ?? 'delivered'} time={item.time} isMyMessage />
    ) : (
      <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
    );
    if (mediaKind === 'voice' && item.audio_url) {
      return (
        <View style={styles.voiceContentWrap}>
          <VoiceMessagePlayer
            uri={item.audio_url}
            durationSeconds={item.audio_duration_seconds}
            isMine={isMe}
            theme={theme}
            wrapStyle={styles.voicePlayerWrap}
            footer={
              <View style={[styles.voiceMetaRow, isMe ? styles.voiceMetaRowMine : null]}>
                {reaction ? <Text style={styles.voiceReactionBadge}>{reaction}</Text> : null}
                {statusOrTime}
              </View>
            }
          />
        </View>
      );
    }
    if (mediaKind === 'vibe_clip' && item.video_url) {
      const clipMeta = extractVibeClipMeta({
        video_url: item.video_url,
        video_duration_seconds: item.video_duration_seconds,
        structured_payload: item.structuredPayload as Record<string, unknown> | null,
        message_kind: item.messageKind,
      });
      if (clipMeta) {
        return (
          <View style={styles.mediaContentWrap}>
            <VibeClipCard
              meta={clipMeta}
              isMine={isMe}
              onReplyWithClip={isMe ? undefined : () => openVideoMessageOptions()}
              onVoiceReply={isMe ? undefined : () => armVoiceReply()}
            />
            <View style={styles.mediaMetaBlock}>
              {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
              {statusOrTime}
            </View>
          </View>
        );
      }
    }
    if ((mediaKind === 'video' || (mediaKind === 'vibe_clip' && item.video_url)) && item.video_url) {
      return (
        <View style={styles.mediaContentWrap}>
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
    const imageUrl =
      localMedia?.payload.kind === 'image'
        ? localMedia.payload.uri
        : mediaKind === 'image'
          ? parseChatImageMessageContent(item.text)
          : null;
    if (imageUrl) {
      return (
        <View style={styles.mediaContentWrap}>
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

  const renderItem: ListRenderItem<ThreadMessage> = ({ item, index }) => {
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

    // Full-width timeline card (same outer container semantics as date suggestion rows — not a left/right chat bubble).
    if (item.messageKind === 'vibe_game_session' && item.gameSessionView) {
      return (
        <View style={{ marginBottom: spacing.md, width: '100%' }}>
          <GameSessionBubble
            view={item.gameSessionView}
            matchId={data?.matchId ?? ''}
            currentUserId={user?.id ?? ''}
            partnerName={otherName ?? 'Them'}
            timeLabel={item.time}
          />
        </View>
      );
    }

    const isMe = item.sender === 'me';
    const messages = displayMessages;
    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const prev = index > 0 ? messages[index - 1] : null;
    const isLastInGroup = !next || next.sender !== item.sender;
    const mediaKind = inferChatMediaRenderKind({
      content: item.text,
      audioUrl: item.audio_url,
      videoUrl: item.video_url,
      messageKind: item.messageKind,
    });
    const isMediaBubble = mediaKind === 'video' || mediaKind === 'image' || mediaKind === 'vibe_clip';
    const prevKind = prev
      ? inferChatMediaRenderKind({ content: prev.text, audioUrl: prev.audio_url, videoUrl: prev.video_url, messageKind: prev.messageKind })
      : 'text';
    const nextKind = next
      ? inferChatMediaRenderKind({ content: next.text, audioUrl: next.audio_url, videoUrl: next.video_url, messageKind: next.messageKind })
      : 'text';
    const prevIsMedia = prevKind === 'video' || prevKind === 'image' || prevKind === 'vibe_clip';
    const nextIsMedia = nextKind === 'video' || nextKind === 'image' || nextKind === 'vibe_clip';
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
          if (!reactionHintShown) {
            Alert.alert('Reactions', 'Reactions are currently local to this device.');
            setReactionHintShown(true);
          }
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
            onPress={() => openGamesEntry()}
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
            style={[styles.composerIconBtn, { backgroundColor: sendingVideo ? 'rgba(139,92,246,0.12)' : theme.muted }]}
            onPress={() => openVideoMessageOptions()}
            disabled={isSending}
            accessibilityLabel="Send a Vibe Clip"
          >
            {sendingVideo ? (
              <ActivityIndicator size="small" color="rgba(139,92,246,1)" />
            ) : (
              <Ionicons name="film-outline" size={20} color={sendingVideo ? 'rgba(139,92,246,1)' : theme.textSecondary} />
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
            style={[
              styles.composerIconBtn,
              {
                backgroundColor: recording
                  ? theme.dangerSoft
                  : voiceReplyHint
                    ? 'rgba(139,92,246,0.18)'
                    : theme.muted,
              },
              voiceReplyHint && { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(139,92,246,0.5)' },
            ]}
            onPress={handleVoicePress}
            disabled={isSending && !recording}
            accessibilityLabel="Voice message"
          >
            {sendingVoice ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : recording ? (
              <Ionicons name="stop" size={20} color={theme.danger} />
            ) : (
              <Ionicons name="mic-outline" size={20} color={voiceReplyHint ? 'rgba(139,92,246,1)' : theme.textSecondary} />
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

      {data?.matchId ? (
        <GamesPickerSheet
          visible={showGamesPicker}
          onClose={() => setShowGamesPicker(false)}
          showBrowserFallback={GAMES_WEB_FALLBACK}
          onSelectGame={handleGamesPickerSelect}
          onOpenBrowser={() => {
            setShowGamesPicker(false);
            void openGamesWebInBrowser();
          }}
        />
      ) : null}
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
      <ActiveDateSuggestionWarningModal
        visible={showActiveDateSuggestionWarning}
        onClose={() => setShowActiveDateSuggestionWarning(false)}
      />
      {data?.matchId ? (
        <CharadesStartSheet
          visible={showCharadesStart}
          onClose={() => setShowCharadesStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
        />
      ) : null}
      {data?.matchId ? (
        <IntuitionStartSheet
          visible={showIntuitionStart}
          onClose={() => setShowIntuitionStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
        />
      ) : null}
      {data?.matchId ? (
        <RouletteStartSheet
          visible={showRouletteStart}
          onClose={() => setShowRouletteStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
        />
      ) : null}
      {data?.matchId ? (
        <ScavengerStartSheet
          visible={showScavengerStart}
          onClose={() => setShowScavengerStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
        />
      ) : null}
      {data?.matchId ? (
        <TwoTruthsStartSheet
          visible={showTwoTruthsStart}
          onClose={() => setShowTwoTruthsStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
        />
      ) : null}
      {data?.matchId ? (
        <WouldRatherStartSheet
          visible={showWouldRatherStart}
          onClose={() => setShowWouldRatherStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
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
  mediaContentWrap: { width: MEDIA_CARD_SIZE, maxWidth: '100%', minWidth: MEDIA_CARD_MIN_WIDTH },
  mediaMetaBlock: { marginTop: 6, width: '100%', minWidth: 0, alignSelf: 'stretch' },
  voiceContentWrap: { width: MEDIA_CARD_SIZE, maxWidth: '100%', minWidth: MEDIA_CARD_MIN_WIDTH },
  voiceMetaRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minWidth: 0, gap: 8 },
  voiceMetaRowMine: { justifyContent: 'flex-end' },
  voiceReactionBadge: { fontSize: 14, flexShrink: 0 },
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
  localSendRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  localSendRowFailed: {
    justifyContent: 'space-between',
  },
  localSendActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  localSendText: {
    fontSize: 10,
    opacity: 0.9,
  },
  retryActionBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  retryActionText: {
    fontSize: 11,
    fontWeight: '600',
  },
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
  voicePlayerWrap: { minWidth: MEDIA_CARD_MIN_WIDTH, width: '100%', maxWidth: MEDIA_CARD_SIZE },
  chatVideoCardOuter: {
    width: '100%',
    maxWidth: MEDIA_CARD_SIZE,
    minWidth: MEDIA_CARD_MIN_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  chatVideoInner: { width: '100%', aspectRatio: 16 / 9 },
  chatVideoCard: { width: '100%', aspectRatio: 16 / 9 },
  chatVideoError: { alignItems: 'center', justifyContent: 'center' },
  chatVideoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,18,0.28)',
    gap: 6,
  },
  chatVideoFallbackLabel: { color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: '600' },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: '80%',
  },
  videoDurationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  chatImageOuter: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MEDIA_CARD_SIZE,
    minWidth: MEDIA_CARD_MIN_WIDTH,
  },
  chatImage: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  voiceError: { fontSize: 12, marginTop: 4, marginHorizontal: layout.containerPadding },
  recordingHint: { fontSize: 12, marginTop: 4, marginHorizontal: layout.containerPadding },
});
