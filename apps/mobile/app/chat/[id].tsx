import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
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
  ActivityIndicator,
  Image,
  Vibration,
  Dimensions,
  type DimensionValue,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '@/constants/Colors';
import { ErrorState } from '@/components/ui';
import { useVibelyDialog } from '@/components/VibelyDialog';
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
  type ChatOtherUser,
  type ReactionEmoji,
  type ThreadInvalidateScope,
} from '@/lib/chatApi';
import { useMessageReactions } from '@/lib/useMessageReactions';
import { setMessageReaction } from '@/lib/messageReactions';
import { reactionPairFromRows } from '../../../../shared/chat/messageReactionModel';
import type { ReactionPair } from '../../../../shared/chat/messageReactionModel';
import type { DateComposerLaunchSource } from '../../../../shared/dateSuggestions/dateComposerLaunch';
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
import { chatFriendlyErrorFromUnknown, isLikelyNetworkFailure } from '@/lib/networkErrorMessage';
import { avatarUrl } from '@/lib/imageUrl';
import { getChatPartnerActivityLine } from '@/lib/chatActivityStatus';
import { supabase } from '@/lib/supabase';
import { inferChatMediaRenderKind, parseChatImageMessageContent } from '@/lib/chatMessageContent';
import { extractVibeClipMeta } from '../../../../shared/chat/messageRouting';
import { VibeClipCard } from '@/components/chat/VibeClipCard';
import {
  ChatThreadPhotoViewerModal,
  ChatThreadVideoViewerModal,
  type ChatThreadPhotoItem,
} from '@/components/chat/ChatThreadMediaViewer';
import { dedupeLatestByRefId } from '../../../../shared/chat/refDedupe';
import { format } from 'date-fns';
import {
  buildThreadPresentationRows,
  type ThreadPresentationRow,
} from '../../../../shared/chat/threadPresentation';
import { threadMessagesQueryKey } from '../../../../shared/chat/queryKeys';
import { useChatOutbox } from '@/lib/chatOutbox/ChatOutboxContext';
import type { ChatOutboxItem, ChatOutboxQueueState } from '@/lib/chatOutbox/types';
import { copyUriToChatOutboxCache, extForPayload } from '@/lib/chatOutbox/mediaCache';
import { matchHasOpenDateSuggestion } from '../../../../shared/dateSuggestions/openStatus';
import {
  VIBE_CLIP_MAX_DURATION_SEC,
  VIBE_CLIP_PERM_CAMERA_MESSAGE,
  VIBE_CLIP_PERM_CAMERA_TITLE,
  VIBE_CLIP_PERM_LIBRARY_MESSAGE,
  VIBE_CLIP_PERM_LIBRARY_TITLE,
} from '../../../../shared/chat/vibeClipCaptureCopy';
import { VibeClipSendOptionsSheet } from '@/components/chat/VibeClipSendOptionsSheet';
import { trackVibeClipEvent } from '@/lib/vibeClipAnalytics';
import { safeVideoPlayerCall } from '@/lib/expoVideoSafe';
import { durationBucketFromSeconds, threadBucketFromCount } from '../../../../shared/chat/vibeClipAnalytics';
import { outboxPhaseStatusLabel, type OutboxPayloadKind } from '../../../../shared/chat/outgoingStatusLabels';

const WEB_APP_ORIGIN = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://vibelymeet.com';

/** When true, Games chip includes "Open in browser" alongside native game starts. */
const GAMES_WEB_FALLBACK = true;

function ChatThreadSkeletonNative({ theme }: { theme: (typeof Colors)['light'] }) {
  const rows: { align: 'flex-start' | 'flex-end'; w: DimensionValue }[] = [
    { align: 'flex-start', w: '72%' },
    { align: 'flex-end', w: '56%' },
    { align: 'flex-start', w: '68%' },
    { align: 'flex-end', w: '50%' },
    { align: 'flex-start', w: '78%' },
  ];
  return (
    <View style={styles.skeletonWrap} accessibilityLabel="Loading messages">
      {rows.map((row, i) => (
        <View
          key={i}
          style={[styles.skeletonRow, { justifyContent: row.align }]}
        >
          <View
            style={[
              styles.skeletonBar,
              {
                width: row.w,
                backgroundColor: theme.muted,
                opacity: 0.55,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

/** Message list + chrome background (slightly lifted from pure black). */
const CHAT_CANVAS_BG = 'hsl(240, 10%, 6%)';
const MEDIA_CARD_SIZE = Math.max(
  158,
  Math.min(192, Math.floor((Dimensions.get('window').width - layout.containerPadding * 2 - 92) * 0.92))
);
const MEDIA_CARD_MIN_WIDTH = 150;

type LocalMediaSendPayload =
  | { kind: 'image'; uri: string; mimeType: string }
  | { kind: 'voice'; uri: string; durationSeconds: number }
  | { kind: 'video'; uri: string; durationSeconds: number; mimeType?: string; aspectRatio?: number };

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

type ChatListRow = ThreadPresentationRow<ThreadMessage>;

function bubbleMediaNeighbors(
  rows: ChatListRow[],
  at: number,
): { prev: ThreadMessage | null; next: ThreadMessage | null } {
  const isTimeline = (m: ThreadMessage) =>
    m.messageKind === 'date_suggestion' ||
    m.messageKind === 'date_suggestion_event' ||
    m.messageKind === 'vibe_game_session';
  let prev: ThreadMessage | null = null;
  for (let i = at - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.type !== 'message') {
      prev = null;
      break;
    }
    if (isTimeline(r.message)) {
      prev = null;
      break;
    }
    prev = r.message;
    break;
  }
  let next: ThreadMessage | null = null;
  for (let i = at + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type !== 'message') {
      next = null;
      break;
    }
    if (isTimeline(r.message)) {
      next = null;
      break;
    }
    next = r.message;
    break;
  }
  return { prev, next };
}

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
  const label = outboxPhaseStatusLabel(phase, payloadKind as OutboxPayloadKind);
  return label || null;
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

function ChatImageCard({
  uri,
  isMine,
  theme: _theme,
  onPress,
}: {
  uri: string;
  isMine: boolean;
  theme: (typeof Colors)['light'];
  onPress?: () => void;
}) {
  const frameBorder = isMine ? 'rgba(236,72,153,0.45)' : 'rgba(255,255,255,0.16)';
  const inner = (
    <View style={[styles.chatImageOuter, { borderColor: frameBorder }]}>
      <Image source={{ uri }} style={styles.chatImage} resizeMode="cover" accessibilityIgnoresInvertColors />
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      accessibilityLabel="View photo full screen"
      accessibilityRole="button"
    >
      {inner}
    </Pressable>
  );
}

type ChatVideoCardProps = {
  uri: string;
  durationSec?: number | null;
  theme: (typeof Colors)['light'];
  isMine: boolean;
  onRequestImmersive?: () => void;
  immersiveActive?: boolean;
  threadVisualRecede?: boolean;
};

/** Remount inner body so expo-video player is recreated after a load error (Try again). */
function ChatVideoCard(props: ChatVideoCardProps) {
  const [retryNonce, setRetryNonce] = useState(0);
  return <ChatVideoCardBody key={`${props.uri}-${retryNonce}`} {...props} onRemountPlayer={() => setRetryNonce((n) => n + 1)} />;
}

function ChatVideoCardBody({
  uri,
  durationSec,
  theme,
  isMine,
  onRequestImmersive,
  immersiveActive,
  threadVisualRecede = false,
  onRemountPlayer,
}: ChatVideoCardProps & { onRemountPlayer: () => void }) {
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
        setHasError(false);
        setIsReady(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (immersiveActive) safeVideoPlayerCall(() => player.pause());
  }, [immersiveActive, player]);

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
          borderColor: isMine ? 'rgba(236,72,153,0.55)' : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.04)',
          opacity: threadVisualRecede ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.chatVideoTypeRow}>
        <View style={styles.chatVideoTypePill}>
          <Text style={styles.chatVideoTypeLabel}>VIDEO</Text>
        </View>
      </View>
      <View style={styles.chatVideoInner}>
        <VideoView
          style={[StyleSheet.absoluteFillObject, hasError ? { opacity: 0 } : null]}
          player={player}
          nativeControls
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.6)']}
          style={styles.chatVideoBottomGradient}
          pointerEvents="none"
        />
      </View>
      {!isReady && !hasError ? (
        <View style={styles.chatVideoFallback}>
          <View style={styles.chatVideoFallbackInner}>
            <ActivityIndicator color="rgba(216,180,254,0.95)" size="small" />
            <Text style={styles.chatVideoFallbackLabel}>Preparing playback…</Text>
          </View>
        </View>
      ) : null}
      {hasError ? (
        <View style={[styles.chatVideoFallback, styles.chatVideoErrorOverlay]} pointerEvents="box-none">
          <Ionicons name="videocam-off-outline" size={28} color="rgba(196,181,253,0.85)" />
          <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            Couldn&apos;t load video
          </Text>
          <Pressable
            onPress={onRemountPlayer}
            style={({ pressed }) => [
              { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(192,132,252,0.4)',
                backgroundColor: 'rgba(139,92,246,0.12)',
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(216,180,254,0.95)' }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {onRequestImmersive ? (
        <Pressable
          onPress={onRequestImmersive}
          style={({ pressed }) => [
            styles.chatVideoExpandBtn,
            {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: 'rgba(255,255,255,0.2)',
              backgroundColor: 'rgba(0,0,0,0.45)',
            },
            pressed && { opacity: 0.88 },
          ]}
          accessibilityLabel="Open video full screen"
          hitSlop={8}
        >
          <Ionicons name="expand-outline" size={20} color="rgba(255,255,255,0.95)" />
        </Pressable>
      ) : null}
      {durLabel ? (
        <View style={[styles.videoDurationBadge, { backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' }]}>
          <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.95)" style={{ marginRight: 4 }} />
          <Text numberOfLines={1} style={styles.videoDurationText}>
            {durLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function normalizeRouteUserId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  return undefined;
}

export default function ChatThreadScreen() {
  const { id: routeChatId } = useLocalSearchParams<{ id: string | string[] }>();
  const otherUserId = normalizeRouteUserId(routeChatId);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useMessages(otherUserId ?? undefined, user?.id ?? null);
  const shellLoading = isLoading && !data;
  const { data: matches = [] } = useMatches(user?.id);
  const matchRowEarly = otherUserId ? matches.find((m) => m.id === otherUserId) : undefined;
  const queryClient = useQueryClient();
  const { enqueue, retry, remove, itemsForMatch, reconcileWithServerIds } = useChatOutbox();
  useRealtimeMessages({
    matchId: data?.matchId ?? null,
    enabled: !!data?.matchId && !!otherUserId && !!user?.id,
    threadOtherUserId: otherUserId ?? undefined,
    threadCurrentUserId: user?.id ?? undefined,
  });
  const { data: reactionRows = [] } = useMessageReactions(data?.matchId);
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
  const [showDateSheet, setShowDateSheet] = useState(false);
  const [dateComposerLaunchSource, setDateComposerLaunchSource] = useState<DateComposerLaunchSource>('default');
  const [showVibeClipSendSheet, setShowVibeClipSendSheet] = useState(false);
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
  const [photoViewer, setPhotoViewer] = useState<{ initialId: string } | null>(null);
  const [videoViewer, setVideoViewer] = useState<{ uri: string; poster?: string | null } | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceRecordStartedAtRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [voiceReplyHint, setVoiceReplyHint] = useState(false);
  const [expandedPendingClusterKey, setExpandedPendingClusterKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatListRow>>(null);
  const inputRef = useRef<TextInput>(null);
  const stickToBottomRef = useRef(true);
  /** Until first content-size snap for this thread, ignore scroll race that clears stickToBottom before scrollToEnd. */
  const pendingThreadBottomSnapRef = useRef(false);
  const lastThreadCountRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelowCue, setNewBelowCue] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const { show: showAppDialog, dialog: appDialog } = useVibelyDialog();

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

  /** True while any outbox item is actively sending (UI indicators only — must not lock the TextInput or iOS dismisses the keyboard). */
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
  /** Locks composer typing: photo pipeline or voice recording. Outbox transitions must not flip this (was collapsing keyboard on Queued→Sending). */
  const composerInputLocked = sendingPhoto || recording;
  const sendFabDisabled = shellLoading || !input.trim() || composerInputLocked;

  const displayMessages = useMemo(() => {
    return dedupeLatestByRefId<ThreadMessage>(threadMessages, {
      isDedupeCandidate: (m) => m.messageKind === 'date_suggestion' || m.messageKind === 'date_suggestion_event',
      getRefId: (m) => m.refId,
      getId: (m) => m.id,
    });
  }, [threadMessages]);

  const threadInvalidateScope = useMemo((): ThreadInvalidateScope | undefined => {
    if (!otherUserId || !user?.id) return undefined;
    return {
      otherUserId,
      currentUserId: user.id,
      matchId: data?.matchId ?? null,
    };
  }, [otherUserId, user?.id, data?.matchId]);

  const lastThreadMsgIdRef = useRef<string | undefined>(undefined);
  const lastThreadLenRef = useRef(0);
  useEffect(() => {
    if (displayMessages.length === 0) {
      lastThreadMsgIdRef.current = undefined;
      lastThreadLenRef.current = 0;
      return;
    }
    const last = displayMessages[displayMessages.length - 1]!;
    const prevId = lastThreadMsgIdRef.current;
    const prevLen = lastThreadLenRef.current;
    const grew = displayMessages.length > prevLen;
    lastThreadMsgIdRef.current = last.id;
    lastThreadLenRef.current = displayMessages.length;
    if (prevId === undefined) return;
    if (last.id === prevId) return;
    if (!grew) return;
    if (last.sender === 'them') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [displayMessages]);

  const chatPhotoGalleryItems = useMemo((): ChatThreadPhotoItem[] => {
    const out: ChatThreadPhotoItem[] = [];
    for (const m of displayMessages) {
      const kind = inferChatMediaRenderKind({
        content: m.text,
        audioUrl: m.audio_url,
        videoUrl: m.video_url,
        messageKind: m.messageKind,
      });
      if (kind !== 'image') continue;
      const u = parseChatImageMessageContent(m.text);
      if (u) out.push({ id: m.id, uri: u });
    }
    return out;
  }, [displayMessages]);

  const scrollAnchorKey = useMemo(() => {
    const last = displayMessages[displayMessages.length - 1];
    return last ? `${displayMessages.length}:${last.id}` : '';
  }, [displayMessages]);

  const listOnScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const atBottom = dist < 100;
    stickToBottomRef.current = atBottom;
    setAwayFromBottom(dist > 140);
    if (atBottom) setNewBelowCue(false);
  }, []);

  const listOnContentSizeChange = useCallback(() => {
    if (displayMessages.length === 0 && !shellLoading) {
      pendingThreadBottomSnapRef.current = false;
      return;
    }
    if (pendingThreadBottomSnapRef.current) {
      pendingThreadBottomSnapRef.current = false;
      stickToBottomRef.current = true;
      setAwayFromBottom(false);
      setNewBelowCue(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      return;
    }
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, [displayMessages.length, shellLoading]);

  useEffect(() => {
    if (!scrollAnchorKey) return;
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [scrollAnchorKey]);

  useEffect(() => {
    const n = displayMessages.length;
    const prev = lastThreadCountRef.current;
    if (n > prev && prev > 0 && awayFromBottom) {
      setNewBelowCue(true);
    }
    lastThreadCountRef.current = n;
  }, [displayMessages.length, awayFromBottom]);

  useLayoutEffect(() => {
    lastThreadCountRef.current = 0;
    setNewBelowCue(false);
    setAwayFromBottom(false);
    stickToBottomRef.current = true;
    pendingThreadBottomSnapRef.current = true;
  }, [otherUserId]);

  useEffect(() => {
    setExpandedPendingClusterKey(null);
  }, [otherUserId]);

  useEffect(() => {
    if (!showVibeClipSendSheet) return;
    trackVibeClipEvent('clip_entry_opened', {
      thread_bucket: threadBucketFromCount(displayMessages.length),
      is_sender: true,
      launched_from: 'chat',
    });
    // Intentionally omit displayMessages.length: avoid duplicate events if thread updates while sheet stays open.
  }, [showVibeClipSendSheet]);

  useEffect(() => {
    if (!showDateSheet || dateComposerLaunchSource !== 'vibe_clip') return;
    trackVibeClipEvent('clip_date_flow_opened', {
      launched_from: 'clip_context',
      thread_bucket: threadBucketFromCount(displayMessages.length),
    });
  }, [showDateSheet, dateComposerLaunchSource]);

  const reactionByMessageId = useMemo(() => {
    if (!user?.id || !otherUserId) return new Map<string, ReactionPair>();
    const byMsg = new Map<string, { message_id: string; profile_id: string; emoji: string }[]>();
    for (const r of reactionRows) {
      const arr = byMsg.get(r.message_id) ?? [];
      arr.push(r);
      byMsg.set(r.message_id, arr);
    }
    const out = new Map<string, ReactionPair>();
    for (const [mid, rows] of byMsg) {
      out.set(mid, reactionPairFromRows(rows, user.id, otherUserId));
    }
    return out;
  }, [reactionRows, user?.id, otherUserId]);

  const suggestionById = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of dateSuggestions) {
      map.set(s.id, s);
    }
    return map;
  }, [dateSuggestions]);

  const lastClipOrVideoIndex = useMemo(() => {
    let last = -1;
    displayMessages.forEach((m, i) => {
      const k = inferChatMediaRenderKind({
        content: m.text,
        audioUrl: m.audio_url,
        videoUrl: m.video_url,
        messageKind: m.messageKind,
      });
      if (k === 'vibe_clip' || k === 'video') last = i;
    });
    return last;
  }, [displayMessages]);

  const chatFlatRows = useMemo(
    () =>
      buildThreadPresentationRows(displayMessages, {
        isDateTimeline: (m) =>
          m.messageKind === 'date_suggestion' || m.messageKind === 'date_suggestion_event',
        getRefId: (m) => m.refId ?? null,
        suggestionStatus: (refId) => suggestionById.get(refId)?.status,
        isPendingGame: (m) =>
          m.messageKind === 'vibe_game_session' && m.gameSessionView?.status === 'active',
        expandedPendingKey: expandedPendingClusterKey,
      }),
    [displayMessages, suggestionById, expandedPendingClusterKey],
  );

  const openDateComposer = useCallback(
    (opts: {
      mode: 'new' | 'counter' | 'editDraft';
      draftId?: string;
      draftPayload?: Record<string, unknown> | null;
      counter?: { suggestionId: string; previousRevision: DateSuggestionWithRelations['revisions'][0] };
      launchFrom?: DateComposerLaunchSource;
    }) => {
      if (opts.mode === 'counter' && opts.counter) {
        setDateComposerLaunchSource('default');
        setComposerCounter({
          suggestionId: opts.counter.suggestionId,
          previousRevision: opts.counter.previousRevision,
        });
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      } else if (opts.mode === 'editDraft' && opts.draftId) {
        setDateComposerLaunchSource('default');
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
        setDateComposerLaunchSource(opts.launchFrom ?? 'default');
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
    setDateComposerLaunchSource('default');
  }, []);

  const onDateSuggestionUpdated = useCallback(() => {
    void refetchDateSuggestions();
    if (otherUserId && user?.id) {
      queryClient.invalidateQueries({
        queryKey: threadMessagesQueryKey(otherUserId, user.id),
        exact: true,
      });
    }
  }, [refetchDateSuggestions, queryClient, otherUserId, user?.id]);

  useEffect(() => {
    const mid = data?.matchId;
    if (!mid || !otherUserId || !user?.id) return;
    const t = setTimeout(() => {
      markMatchMessagesRead(mid)
        .then(() => {
          const key = threadMessagesQueryKey(otherUserId, user.id);
          queryClient.setQueryData(key, (old: unknown) => {
            if (!old || typeof old !== 'object' || !('messages' in old)) return old;
            const o = old as {
              messages: ChatMessage[];
              matchId: string | null;
              otherUser: ChatOtherUser | null;
            };
            const nowIso = new Date().toISOString();
            return {
              ...o,
              messages: o.messages.map((m) =>
                m.sender === 'them' && (m.read_at == null || m.read_at === undefined)
                  ? { ...m, read_at: nowIso }
                  : m
              ),
            };
          });
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [data?.matchId, data?.messages?.length, otherUserId, user?.id, queryClient]);

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
    matchId: data?.matchId ?? matchRowEarly?.matchId ?? null,
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
      : shellLoading && matchRowEarly && otherUserId
        ? {
            matchId: matchRowEarly.matchId,
            id: otherUserId,
            name: otherName,
            archived_at: matchRowEarly.archived_at ?? null,
          }
        : null;

  const handleSend = () => {
    const text = input.trim();
    if (!text || !data?.matchId || !user?.id || composerInputLocked) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stickToBottomRef.current = true;
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
    requestAnimationFrame(() => inputRef.current?.focus());
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
      const isPerm =
        e instanceof Error &&
        (e.message.toLowerCase().includes('permission') || e.message.toLowerCase().includes('denied'));
      if (isPerm) {
        setVoiceError(null);
        showAppDialog({
          title: 'Microphone needed',
          message: 'Allow mic access so you can send voice messages.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      const msg = chatFriendlyErrorFromUnknown(e);
      setVoiceError(msg);
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        showAppDialog({
          title: 'Recording issue',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
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
      const msg = chatFriendlyErrorFromUnknown(e);
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        showAppDialog({
          title: 'Voice message failed',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
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
    if (!data?.matchId || !user?.id || composerInputLocked) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAppDialog({
          title: VIBE_CLIP_PERM_LIBRARY_TITLE,
          message: VIBE_CLIP_PERM_LIBRARY_MESSAGE,
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      trackVibeClipEvent('clip_record_started', {
        capture_source: 'library',
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.7,
        videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      trackVibeClipEvent('clip_record_completed', {
        capture_source: 'library',
        duration_bucket: durationBucketFromSeconds(durationSec > 0 ? durationSec : null),
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? undefined));
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
          mimeType: asset.mimeType ?? undefined,
          aspectRatio:
            typeof asset.width === 'number' && typeof asset.height === 'number' && asset.height > 0
              ? asset.width / asset.height
              : undefined,
        },
      });
      trackVibeClipEvent('clip_send_attempted', {
        capture_source: 'library',
        duration_bucket: durationBucketFromSeconds(durationSec > 0 ? durationSec : null),
        has_poster: false,
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
    } catch (e) {
      const msg = chatFriendlyErrorFromUnknown(e, { isVibeClip: true });
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        setVideoError(msg);
        showAppDialog({
          title: 'Vibe Clip',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else {
        setVideoError(null);
      }
    }
  };

  /** Primary video-message flow: record with the device camera (not library-only). */
  const recordVideoWithCamera = async () => {
    if (!data?.matchId || !user?.id || composerInputLocked) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showAppDialog({
          title: VIBE_CLIP_PERM_CAMERA_TITLE,
          message: VIBE_CLIP_PERM_CAMERA_MESSAGE,
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      trackVibeClipEvent('clip_record_started', {
        capture_source: 'camera',
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      trackVibeClipEvent('clip_record_completed', {
        capture_source: 'camera',
        duration_bucket: durationBucketFromSeconds(durationSec > 0 ? durationSec : null),
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? 'video/mp4'));
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
          mimeType: asset.mimeType ?? 'video/mp4',
          aspectRatio:
            typeof asset.width === 'number' && typeof asset.height === 'number' && asset.height > 0
              ? asset.width / asset.height
              : undefined,
        },
      });
      trackVibeClipEvent('clip_send_attempted', {
        capture_source: 'camera',
        duration_bucket: durationBucketFromSeconds(durationSec > 0 ? durationSec : null),
        has_poster: false,
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
    } catch (e) {
      const msg = chatFriendlyErrorFromUnknown(e, { isVibeClip: true });
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        setVideoError(msg);
        showAppDialog({
          title: 'Vibe Clip',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else {
        setVideoError(null);
      }
    }
  };

  const openVideoMessageOptions = () => {
    setShowVibeClipSendSheet(true);
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
      const msg = chatFriendlyErrorFromUnknown(e);
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        showAppDialog({
          title: 'Photo',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } finally {
      setSendingPhoto(false);
    }
  };

  const pickPhotoFromLibrary = async () => {
    if (!data?.matchId || !user?.id || composerInputLocked) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAppDialog({
          title: 'Photos access',
          message: 'Allow access to your photos to send a picture.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      await uploadPhotoUriAndSend(result.assets[0].uri, result.assets[0].mimeType ?? null);
    } catch (e) {
      const msg = chatFriendlyErrorFromUnknown(e);
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        showAppDialog({
          title: 'Photo',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    }
  };

  const takePhotoWithCamera = async () => {
    if (!data?.matchId || !user?.id || composerInputLocked) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showAppDialog({
          title: 'Camera access',
          message: 'Allow camera access to take a photo.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      await uploadPhotoUriAndSend(result.assets[0].uri, result.assets[0].mimeType ?? null);
    } catch (e) {
      const msg = chatFriendlyErrorFromUnknown(e);
      if (!(isOffline && isLikelyNetworkFailure(e))) {
        showAppDialog({
          title: 'Photo',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    }
  };

  const openPhotoOptions = () => {
    showAppDialog({
      title: 'Send a photo',
      message: 'Choose how you’d like to add your picture.',
      variant: 'info',
      primaryAction: { label: 'Take photo', onPress: () => void takePhotoWithCamera() },
      secondaryAction: { label: 'Choose from library', onPress: () => void pickPhotoFromLibrary() },
    });
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
      showAppDialog({
        title: 'Games',
        message: 'Could not open the browser. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
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

  const threadAnchorSubtitle = useMemo(() => {
    const first = data?.messages?.[0];
    if (first?.sortAtMs == null) return null;
    try {
      return `Chat since ${format(new Date(first.sortAtMs), 'MMM yyyy')}`;
    } catch {
      return null;
    }
  }, [data?.messages]);

  if (!otherUserId || !user?.id) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Invalid chat"
            message="This conversation could not be loaded."
            actionLabel="Go back"
            onActionPress={() => router.back()}
          />
        </View>
        {appDialog}
      </>
    );
  }

  if (!isLoading && (error || !data)) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Could not load conversation"
            message="Check your connection and try again."
            actionLabel="Retry"
            onActionPress={() => refetch()}
          />
        </View>
        {appDialog}
      </>
    );
  }

  if (!isLoading && data && !data.matchId) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="No conversation found"
            message="This match may have been removed."
            actionLabel="Go back"
            onActionPress={() => router.back()}
          />
        </View>
        {appDialog}
      </>
    );
  }

  const otherUser = data?.otherUser ?? null;
  const otherAvatarUri = otherUser
    ? (otherUser.photos?.[0] ?? otherUser.avatar_url)
      ? avatarUrl(otherUser.photos?.[0] ?? otherUser.avatar_url ?? null)
      : null
    : otherUserId
      ? matchRowEarly?.image
        ? avatarUrl(matchRowEarly.image)
        : null
      : null;
  const lastSeenAt = otherUser?.last_seen_at ? new Date(otherUser.last_seen_at).getTime() : null;
  const activityLine = getChatPartnerActivityLine({
    partnerTyping,
    lastSeenAtMs: lastSeenAt,
  });

  const composerMediaError = voiceError || videoError;
  const suppressComposerMediaError =
    !!composerMediaError && isOffline && isLikelyNetworkFailure({ message: composerMediaError });

  const renderBubbleContent = (
    item: ThreadMessage,
    textColor: string,
    timeColor: string,
    isMe: boolean,
    opts?: { threadVisualRecede?: boolean },
  ) => {
    const threadVisualRecede = opts?.threadVisualRecede ?? false;
    const pair = reactionByMessageId.get(item.id) ?? { mine: null, partner: null };
    const reaction =
      pair.mine || pair.partner
        ? [pair.mine, pair.partner].filter((e): e is ReactionEmoji => !!e).join(' ')
        : null;
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
              reactionPair={pair}
              threadMessageCount={displayMessages.length}
              sparkMessageId={item.id}
              onReplyWithClip={isMe ? undefined : () => openVideoMessageOptions()}
              onVoiceReply={isMe ? undefined : () => armVoiceReply()}
              onSuggestDate={
                isMe ? undefined : () => openDateComposer({ mode: 'new', launchFrom: 'vibe_clip' })
              }
              onReact={
                isMe
                  ? undefined
                  : () => {
                      Vibration.vibrate(30);
                      setReactionPickerMessageId(item.id);
                    }
              }
              onRequestImmersive={() =>
                setVideoViewer({ uri: clipMeta.videoUrl, poster: clipMeta.thumbnailUrl ?? null })
              }
              immersiveActive={videoViewer?.uri === clipMeta.videoUrl}
              threadVisualRecede={threadVisualRecede}
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
      const videoUri = item.video_url;
      return (
        <View style={styles.mediaContentWrap}>
          <ChatVideoCard
            uri={videoUri}
            durationSec={item.video_duration_seconds ?? null}
            theme={theme}
            isMine={isMe}
            onRequestImmersive={() => setVideoViewer({ uri: videoUri })}
            immersiveActive={videoViewer?.uri === videoUri}
            threadVisualRecede={threadVisualRecede}
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
          <ChatImageCard
            uri={imageUrl}
            isMine={isMe}
            theme={theme}
            onPress={() => setPhotoViewer({ initialId: item.id })}
          />
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

  const renderItem: ListRenderItem<ChatListRow> = ({ item, index }) => {
    if (item.type === 'pending_games_summary') {
      return (
        <View style={{ marginBottom: spacing.sm, alignItems: 'center', paddingHorizontal: 8 }}>
          <Pressable
            onPress={() => setExpandedPendingClusterKey(item.clusterKey)}
            style={({ pressed }) => [
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
                backgroundColor: theme.surfaceSubtle,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: '600' }}>
              {item.hidden.length} earlier open game{item.hidden.length === 1 ? '' : 's'} · Show
            </Text>
          </Pressable>
        </View>
      );
    }
    if (item.type === 'pending_games_collapse') {
      return (
        <View style={{ marginBottom: spacing.xs, alignItems: 'center' }}>
          <Pressable onPress={() => setExpandedPendingClusterKey(null)}>
            <Text style={{ color: theme.textSecondary, fontSize: 11, textDecorationLine: 'underline' }}>
              Collapse earlier games
            </Text>
          </Pressable>
        </View>
      );
    }

    const msg = item.message;

    const isDateTimeline =
      msg.messageKind === 'date_suggestion' || msg.messageKind === 'date_suggestion_event';
    if (isDateTimeline && !msg.refId) {
      return (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Date suggestion (syncing…)</Text>
        </View>
      );
    }
    if (isDateTimeline && msg.refId) {
      const sug = suggestionById.get(msg.refId);
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
              threadUi={item.dateUi}
            />
          ) : (
            <Text style={{ color: theme.textSecondary, fontSize: 13, paddingVertical: 8 }}>
              Loading date suggestion…
            </Text>
          )}
        </View>
      );
    }

    if (msg.messageKind === 'vibe_game_session' && msg.gameSessionView) {
      if (!user?.id || !otherUserId) {
        return (
          <View style={{ marginBottom: spacing.md, width: '100%' }}>
            <Text style={{ color: theme.textSecondary, fontSize: 13, paddingVertical: 8 }}>Loading game…</Text>
          </View>
        );
      }
      const gameInvalidateScope: ThreadInvalidateScope =
        threadInvalidateScope ?? {
          otherUserId,
          currentUserId: user.id,
          matchId: data?.matchId ?? null,
        };
      return (
        <View style={{ marginBottom: spacing.md, width: '100%' }}>
          <GameSessionBubble
            view={msg.gameSessionView}
            matchId={data?.matchId ?? ''}
            currentUserId={user.id}
            partnerName={otherName ?? 'Them'}
            timeLabel={msg.time}
            invalidateScope={gameInvalidateScope}
          />
        </View>
      );
    }

    const isMe = msg.sender === 'me';
    const { prev, next } = bubbleMediaNeighbors(chatFlatRows, index);
    const isLastInGroup = !next || next.sender !== msg.sender;
    const mediaKind = inferChatMediaRenderKind({
      content: msg.text,
      audioUrl: msg.audio_url,
      videoUrl: msg.video_url,
      messageKind: msg.messageKind,
    });
    const isMediaBubble = mediaKind === 'video' || mediaKind === 'image' || mediaKind === 'vibe_clip';
    const prevKind = prev
      ? inferChatMediaRenderKind({
          content: prev.text,
          audioUrl: prev.audio_url,
          videoUrl: prev.video_url,
          messageKind: prev.messageKind,
        })
      : 'text';
    const nextKind = next
      ? inferChatMediaRenderKind({
          content: next.text,
          audioUrl: next.audio_url,
          videoUrl: next.video_url,
          messageKind: next.messageKind,
        })
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
    const threadIdx = displayMessages.findIndex((m) => m.id === msg.id);
    const mediaRecede =
      threadIdx >= 0 && lastClipOrVideoIndex >= 0 && threadIdx < lastClipOrVideoIndex;
    const content = renderBubbleContent(msg, textColor, timeColor, isMe, {
      threadVisualRecede: mediaRecede,
    });
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
          setReactionPickerMessageId(msg.id);
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
                <View style={styles.headerSubtitleSlot}>
                  {activityLine ? (
                    <Text style={[styles.headerSubtitle, { color: activityColor }]} numberOfLines={1}>
                      {activityLine.text}
                    </Text>
                  ) : threadAnchorSubtitle ? (
                    <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                      {threadAnchorSubtitle}
                    </Text>
                  ) : (
                    <Text style={[styles.headerSubtitle, { color: theme.textSecondary, opacity: 0.75 }]} numberOfLines={1}>
                      Private chat
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
            <View style={styles.headerRightRow}>
              <Pressable
                onPress={() => {
                  if (isOffline) {
                    showAppDialog({
                      title: 'Can’t start a call',
                      message: 'Check your connection and try again.',
                      variant: 'warning',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    });
                    return;
                  }
                  if (data?.matchId ?? matchRowEarly?.matchId) startCall('voice');
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
                    showAppDialog({
                      title: 'Can’t start a call',
                      message: 'Check your connection and try again.',
                      variant: 'warning',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    });
                    return;
                  }
                  if (data?.matchId ?? matchRowEarly?.matchId) startCall('video');
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
              showAppDialog({
                title: 'Unmatch?',
                message: `Remove ${matchForActions.name} from your matches? This can’t be undone.`,
                variant: 'destructive',
                primaryAction: {
                  label: 'Unmatch',
                  onPress: () => {
                    void (async () => {
                      setActionLoading('unmatch');
                      try {
                        await unmatch({ matchId: matchForActions.matchId });
                        setShowActions(false);
                        router.back();
                      } finally {
                        setActionLoading(null);
                      }
                    })();
                  },
                },
                secondaryAction: { label: 'Cancel', onPress: () => {} },
              });
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
              showAppDialog({
                title: 'Block this person?',
                message: `${matchForActions.name} won’t be able to contact you.`,
                variant: 'destructive',
                primaryAction: {
                  label: 'Block',
                  onPress: () => {
                    void (async () => {
                      setActionLoading('block');
                      try {
                        await blockUser({ blockedId: matchForActions.id, matchId: matchForActions.matchId });
                        setShowActions(false);
                        router.back();
                      } finally {
                        setActionLoading(null);
                      }
                    })();
                  },
                },
                secondaryAction: { label: 'Cancel', onPress: () => {} },
              });
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
        <View style={styles.listAndJumpWrap}>
        <FlatList
          ref={listRef}
          data={chatFlatRows}
          renderItem={renderItem}
          keyExtractor={(row) =>
            row.type === 'pending_games_summary'
              ? `ps-${row.clusterKey}`
              : row.type === 'pending_games_collapse'
                ? `pc-${row.clusterKey}`
                : row.message.id
          }
          style={styles.messageList}
          keyboardShouldPersistTaps="handled"
          onScroll={listOnScroll}
          onContentSizeChange={listOnContentSizeChange}
          scrollEventThrottle={16}
          contentContainerStyle={[
            styles.list,
            displayMessages.length === 0 ? styles.listContentEmpty : null,
          ]}
          ListEmptyComponent={
            shellLoading ? (
              <ChatThreadSkeletonNative theme={theme} />
            ) : (
              <View style={styles.waveEmptyWrap}>
                <Text style={styles.waveEmptyEmoji}>👋</Text>
                <Text style={[styles.waveEmptyTitle, { color: theme.text }]}>{"It's a match!"}</Text>
                <Text style={[styles.waveEmptySub, { color: theme.textSecondary }]}>
                  Send a wave to start the conversation
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            partnerTyping ? (
              <View style={styles.typingWrap}>
                <TypingIndicator />
              </View>
            ) : null
          }
        />
        {!shellLoading && awayFromBottom && displayMessages.length > 0 ? (
          <View style={styles.jumpLatestWrap} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                stickToBottomRef.current = true;
                setAwayFromBottom(false);
                setNewBelowCue(false);
                requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
              }}
              style={({ pressed }) => [
                styles.jumpLatestPill,
                {
                  backgroundColor: 'rgba(12,12,18,0.92)',
                  borderColor: 'rgba(255,255,255,0.12)',
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={newBelowCue ? 'Jump to new messages' : 'Jump to latest'}
            >
              <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.88)" />
              <Text style={styles.jumpLatestText}>{newBelowCue ? 'New below' : 'Latest'}</Text>
            </Pressable>
          </View>
        ) : null}
        </View>
        <View style={[styles.contextualRow, { borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: CHAT_CANVAS_BG }]}>
          <Pressable
            onPress={() => {
              if (shellLoading) return;
              openDateComposer({ mode: 'new' });
            }}
            disabled={shellLoading}
            style={({ pressed }) => [
              styles.contextChip,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                opacity: shellLoading ? 0.45 : pressed ? 0.9 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Suggest a date"
          >
            <Ionicons name="calendar-outline" size={14} color={theme.tint} />
            <Text numberOfLines={1} style={[styles.contextChipLabel, { color: theme.text }]}>Date</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (shellLoading) return;
              openGamesEntry();
            }}
            disabled={shellLoading}
            style={({ pressed }) => [
              styles.contextChip,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                opacity: shellLoading ? 0.45 : pressed ? 0.9 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Games"
          >
            <Ionicons name="game-controller-outline" size={14} color={theme.neonCyan} />
            <Text numberOfLines={1} style={[styles.contextChipLabel, { color: theme.text }]}>Games</Text>
          </Pressable>
        </View>
        <View
          style={[
            styles.composerDockCol,
            {
              borderTopColor: 'rgba(255,255,255,0.06)',
              backgroundColor: 'hsl(240, 10%, 8%)',
              paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, spacing.sm) : spacing.md,
            },
          ]}
        >
          {recording ? (
            <View style={styles.recordingHintRow}>
              <View
                style={[
                  styles.recordingHintPill,
                  { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Text style={[styles.recordingHintPillText, { color: theme.textSecondary }]}>
                  Recording… Tap mic to send
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.composerDockRow}>
            <Pressable
              style={[styles.composerIconBtn, { backgroundColor: theme.muted }]}
              onPress={() => openPhotoOptions()}
              disabled={shellLoading || composerInputLocked}
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
              disabled={shellLoading || composerInputLocked}
              accessibilityLabel="Vibe Clip — record or choose a clip"
            >
              {sendingVideo ? (
                <ActivityIndicator size="small" color="rgba(139,92,246,1)" />
              ) : (
                <Ionicons name="film-outline" size={20} color={sendingVideo ? 'rgba(139,92,246,1)' : theme.textSecondary} />
              )}
            </Pressable>
            <TextInput
              ref={inputRef}
              style={[
                styles.inputDock,
                {
                  borderColor: 'rgba(255,255,255,0.1)',
                  color: theme.text,
                  backgroundColor: theme.surface,
                  opacity: shellLoading ? 0.55 : 1,
                },
              ]}
              placeholder={shellLoading ? 'Loading…' : 'Message'}
              placeholderTextColor={theme.textSecondary}
              value={input}
              onChangeText={handleInputChange}
              multiline
              blurOnSubmit={false}
              maxLength={2000}
              editable={!shellLoading && !composerInputLocked}
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
              disabled={(shellLoading || composerInputLocked) && !recording}
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
                sendFabDisabled && styles.sendBtnDisabled,
              ]}
              onPress={handleSend}
              disabled={sendFabDisabled}
              accessibilityLabel="Send message"
            >
              <Ionicons name="arrow-up" size={22} color={theme.primaryForeground} />
            </Pressable>
          </View>
          {composerMediaError && !suppressComposerMediaError ? (
            <Text style={[styles.voiceError, { color: theme.danger }]}>{composerMediaError}</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <ReactionPicker
        visible={!!reactionPickerMessageId}
        onClose={() => setReactionPickerMessageId(null)}
        onSelect={async (emoji) => {
          if (!reactionPickerMessageId || !data?.matchId) return;
          try {
            await setMessageReaction({
              matchId: data.matchId,
              messageId: reactionPickerMessageId,
              emoji,
            });
            setReactionPickerMessageId(null);
            await queryClient.invalidateQueries({ queryKey: ['message-reactions', data.matchId] });
          } catch {
            showAppDialog({
              title: 'Reaction',
              message: 'Could not send reaction. Try again.',
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          }
        }}
        anchorRight={
          !!reactionPickerMessageId &&
          (displayMessages.find((m) => m.id === reactionPickerMessageId)?.sender === 'me')
        }
      />

      <VibeClipSendOptionsSheet
        visible={showVibeClipSendSheet}
        onClose={() => setShowVibeClipSendSheet(false)}
        onRecord={() => {
          setShowVibeClipSendSheet(false);
          void recordVideoWithCamera();
        }}
        onChooseLibrary={() => {
          setShowVibeClipSendSheet(false);
          void pickVideoFromLibrary();
        }}
        disabled={composerInputLocked}
        promptSeed={data?.matchId ?? otherUserId ?? ''}
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
          launchSource={dateComposerLaunchSource}
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
            if (dateComposerLaunchSource === 'vibe_clip') {
              trackVibeClipEvent('clip_date_submitted_from_clip', {
                thread_bucket: threadBucketFromCount(displayMessages.length),
              });
            }
            void refetchDateSuggestions();
            queryClient.invalidateQueries({
              queryKey: threadMessagesQueryKey(otherUserId, user.id),
              exact: true,
            });
          }}
        />
      ) : null}
      <ActiveDateSuggestionWarningModal
        visible={showActiveDateSuggestionWarning}
        onClose={() => setShowActiveDateSuggestionWarning(false)}
      />
      {data?.matchId && threadInvalidateScope ? (
        <CharadesStartSheet
          visible={showCharadesStart}
          onClose={() => setShowCharadesStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      {data?.matchId && threadInvalidateScope ? (
        <IntuitionStartSheet
          visible={showIntuitionStart}
          onClose={() => setShowIntuitionStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      {data?.matchId && threadInvalidateScope ? (
        <RouletteStartSheet
          visible={showRouletteStart}
          onClose={() => setShowRouletteStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      {data?.matchId && threadInvalidateScope ? (
        <ScavengerStartSheet
          visible={showScavengerStart}
          onClose={() => setShowScavengerStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      {data?.matchId && threadInvalidateScope ? (
        <TwoTruthsStartSheet
          visible={showTwoTruthsStart}
          onClose={() => setShowTwoTruthsStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      {data?.matchId && threadInvalidateScope ? (
        <WouldRatherStartSheet
          visible={showWouldRatherStart}
          onClose={() => setShowWouldRatherStart(false)}
          matchId={data.matchId}
          partnerName={otherName ?? 'Them'}
          invalidateScope={threadInvalidateScope}
        />
      ) : null}
      <ChatThreadPhotoViewerModal
        visible={!!photoViewer}
        items={chatPhotoGalleryItems}
        initialId={photoViewer?.initialId ?? ''}
        onClose={() => setPhotoViewer(null)}
      />
      <ChatThreadVideoViewerModal
        visible={!!videoViewer}
        uri={videoViewer?.uri ?? ''}
        posterUri={videoViewer?.poster}
        onClose={() => setVideoViewer(null)}
      />
      {appDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headerOuter: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs + 2 },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
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
  /** Fixed min height so header does not jump when subtitle is null (web `min-h-4` parity). */
  headerSubtitleSlot: { minHeight: 14, justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600' },
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
  listAndJumpWrap: { flex: 1, position: 'relative' },
  messageList: { flex: 1 },
  jumpLatestWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    zIndex: 20,
  },
  jumpLatestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  jumpLatestText: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600' },
  skeletonWrap: { paddingTop: 8, paddingBottom: 24, width: '100%', gap: 10 },
  skeletonRow: { width: '100%', flexDirection: 'row', paddingHorizontal: 0 },
  skeletonBar: { height: 38, borderRadius: 16 },
  list: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
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
    paddingVertical: 8,
  },
  mediaBubbleTight: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  bubbleThemInner: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  bubbleText: { fontSize: 14, lineHeight: 19 },
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
    gap: spacing.xs + 2,
    paddingHorizontal: layout.containerPadding,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
    minWidth: 0,
    flex: 1,
    maxWidth: 168,
    justifyContent: 'center',
  },
  contextChipLabel: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  composerDockCol: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerDockRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  recordingHintRow: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  recordingHintPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  recordingHintPillText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
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
  chatVideoTypeRow: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  chatVideoTypePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chatVideoTypeLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: 'rgba(255,255,255,0.5)',
  },
  chatVideoInner: { width: '100%', aspectRatio: 9 / 16, position: 'relative' },
  chatVideoBottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
  },
  chatVideoCard: { width: '100%', aspectRatio: 16 / 9 },
  chatVideoError: { alignItems: 'center', justifyContent: 'center' },
  chatVideoErrorOverlay: {
    zIndex: 12,
    backgroundColor: 'rgba(17,17,24,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192,132,252,0.35)',
  },
  chatVideoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,8,14,0.5)',
  },
  chatVideoFallbackInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192,132,252,0.22)',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  chatVideoFallbackLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  chatVideoExpandBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 6,
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: '78%',
  },
  videoDurationText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  chatImageOuter: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MEDIA_CARD_SIZE,
    minWidth: MEDIA_CARD_MIN_WIDTH,
  },
  chatImage: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  voiceError: { fontSize: 12, marginTop: spacing.sm, alignSelf: 'center', textAlign: 'center', paddingHorizontal: spacing.md },
});
