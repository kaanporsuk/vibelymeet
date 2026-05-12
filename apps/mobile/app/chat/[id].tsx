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
  useWindowDimensions,
  AppState,
  BackHandler,
  InteractionManager,
  type AppStateStatus,
  type DimensionValue,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
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
import { useUndoableUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { useArchiveMatch } from '@/lib/useArchiveMatch';
import { useMuteMatch, type MuteDuration } from '@/lib/useMuteMatch';
import { MatchActionsSheet } from '@/components/match/MatchActionsSheet';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { UnmatchSnackbar } from '@/components/match/UnmatchSnackbar';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageStatus } from '@/components/chat/MessageStatus';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { VoiceMessagePlayer } from '@/components/chat/VoiceMessagePlayer';
import { DateSuggestionSheet, type WizardState } from '@/components/chat/DateSuggestionSheet';
import { DateSuggestionChatCard } from '@/components/chat/DateSuggestionChatCard';
import { ScheduleShareSheet } from '@/components/chat/ScheduleShareSheet';
import { ActiveDateSuggestionWarningModal } from '@/components/chat/ActiveDateSuggestionWarningModal';
import { CharadesStartSheet } from '@/components/chat/games/CharadesStartSheet';
import { GameSessionBubble } from '@/components/chat/games/GameSessionBubble';
import { IntuitionStartSheet } from '@/components/chat/games/IntuitionStartSheet';
import { RouletteStartSheet } from '@/components/chat/games/RouletteStartSheet';
import { ScavengerStartSheet } from '@/components/chat/games/ScavengerStartSheet';
import { TwoTruthsStartSheet } from '@/components/chat/games/TwoTruthsStartSheet';
import { WouldRatherStartSheet } from '@/components/chat/games/WouldRatherStartSheet';
import { GamesPickerSheet, type GamesPickerGameId } from '@/components/chat/games/GamesPickerSheet';
import { useMatchDateSuggestions, type DateSuggestionWithRelations } from '@/lib/useDateSuggestionData';
import { useQueryClient } from '@tanstack/react-query';
import { useMatchCall } from '@/lib/useMatchCall';
import { useConnectivity } from '@/lib/useConnectivity';
import { chatFriendlyErrorFromUnknown, isLikelyNetworkFailure } from '@/lib/networkErrorMessage';
import { avatarUrl } from '@/lib/imageUrl';
import { getChatPartnerActivityLine } from '@/lib/chatActivityStatus';
import { supabase } from '@/lib/supabase';
import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageMessageContent,
} from '@/lib/chatMessageContent';
import { extractVibeClipMeta } from '../../../../shared/chat/messageRouting';
import { VibeClipCard } from '@/components/chat/VibeClipCard';
import {
  ChatThreadPhotoViewerModal,
  ChatThreadVideoViewerModal,
  type ChatThreadPhotoItem,
} from '@/components/chat/ChatThreadMediaViewer';
import { dedupeLatestByRefId } from '../../../../shared/chat/refDedupe';
import { clientRequestIdFromStructured } from '../../../../shared/chat/clientRequestId';
import { format } from 'date-fns';
import {
  buildThreadPresentationRows,
  type ThreadPresentationRow,
} from '../../../../shared/chat/threadPresentation';
import { threadMessagesQueryKey } from '../../../../shared/chat/queryKeys';
import { useChatOutbox } from '@/lib/chatOutbox/ChatOutboxContext';
import type { ChatOutboxItem, ChatOutboxQueueState } from '@/lib/chatOutbox/types';
import { cleanupOutboxCacheUri, copyUriToChatOutboxCache, extForPayload } from '@/lib/chatOutbox/mediaCache';
import { matchHasOpenDateSuggestion } from '../../../../shared/dateSuggestions/openStatus';
import {
  VIBE_CLIP_MAX_DURATION_SEC,
  VIBE_CLIP_MAX_UPLOAD_BYTES,
  VIBE_CLIP_PERM_CAMERA_MESSAGE,
  VIBE_CLIP_PERM_CAMERA_TITLE,
  VIBE_CLIP_PERM_LIBRARY_MESSAGE,
  VIBE_CLIP_PERM_LIBRARY_TITLE,
  VIBE_CLIP_UPLOAD_DURATION_UNREADABLE,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_INVALID_TYPE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
  VIBE_CLIP_UPLOAD_TOO_LONG,
} from '../../../../shared/chat/vibeClipCaptureCopy';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import { VibeClipSendOptionsSheet } from '@/components/chat/VibeClipSendOptionsSheet';
import { trackVibeClipEvent } from '@/lib/vibeClipAnalytics';
import { safeVideoPlayerCall } from '@/lib/expoVideoSafe';
import { durationBucketFromSeconds, threadBucketFromCount } from '../../../../shared/chat/vibeClipAnalytics';
import { outboxPhaseStatusLabel, type OutboxPayloadKind } from '../../../../shared/chat/outgoingStatusLabels';

const WEB_APP_ORIGIN = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://www.vibelymeet.com';
const MATCHES_TAB_HREF = '/(tabs)/matches' as const;

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
const COMPOSER_CONTROL_SIZE = 40;
const COMPOSER_GAP = 6;
const COMPOSER_INPUT_MAX_HEIGHT = 120;
const MEDIA_CARD_MIN_WIDTH = 150;
const MEDIA_CARD_MAX_WIDTH = 280;
const VOICE_RECORDING_BARS = [0.3, 0.62, 0.42, 0.75, 0.38, 0.58, 0.48, 0.82, 0.34, 0.7, 0.46, 0.64];

function formatVoiceRecordingDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safeSeconds / 60)}:${(safeSeconds % 60).toString().padStart(2, '0')}`;
}

function isPickedVideoAsset(asset: ImagePicker.ImagePickerAsset): boolean {
  if (asset.type === 'video') return true;
  if (asset.mimeType?.startsWith('video/')) return true;
  return /\.(mp4|m4v|mov|webm|avi|mkv)$/i.test(asset.fileName ?? asset.uri);
}

function imagePickerDurationSeconds(asset: ImagePicker.ImagePickerAsset): number | null {
  const durationMs = asset.duration;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return durationMs / 1000;
}

function aspectRatioForVideoAsset(asset: ImagePicker.ImagePickerAsset): number | undefined {
  return typeof asset.width === 'number' && typeof asset.height === 'number' && asset.height > 0
    ? asset.width / asset.height
    : undefined;
}

async function fileSizeBytesForVideoAsset(
  asset: ImagePicker.ImagePickerAsset,
  stableUri?: string,
): Promise<number | null> {
  if (typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize)) return asset.fileSize;
  const candidates = [stableUri, asset.uri].filter((uri): uri is string => !!uri);
  for (const uri of candidates) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && !info.isDirectory && typeof info.size === 'number') return info.size;
    } catch {
      // Best effort; upload-chat-video remains the final server-side guard.
    }
  }
  return null;
}

async function discardTemporaryVoiceUri(uri: string | null | undefined): Promise<void> {
  if (!uri || uri.startsWith('blob:')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort only; cancel must never enter the upload/send path.
  }
}

function getAdaptiveChatMediaWidth(windowWidth: number): number {
  const availableThreadWidth = Math.max(
    MEDIA_CARD_MIN_WIDTH,
    windowWidth - layout.containerPadding * 2 - 92
  );
  return Math.max(
    MEDIA_CARD_MIN_WIDTH,
    Math.min(MEDIA_CARD_MAX_WIDTH, Math.floor(availableThreadWidth * 0.92))
  );
}

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

function threadMessageMediaKind(message: ThreadMessage) {
  if (isLocalMediaMessage(message) && message.localMedia.payload.kind === 'image') return 'image';
  return inferChatMediaRenderKind({
    content: message.text,
    audioUrl: message.audio_url,
    videoUrl: message.video_url,
    messageKind: message.messageKind,
  });
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
    const aspectRatio =
      typeof p.aspectRatio === 'number' && Number.isFinite(p.aspectRatio) && p.aspectRatio > 0
        ? p.aspectRatio
        : null;
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
      structuredPayload: {
        v: 2,
        kind: 'vibe_clip',
        client_request_id: item.id,
        duration_ms: Math.round(p.durationSeconds * 1000),
        thumbnail_url: null,
        poster_source: 'first_frame',
        aspect_ratio: aspectRatio,
        processing_status: 'ready',
        upload_provider: 'bunny',
      },
      localMedia,
    };
  }
  return {
    id,
    text: formatChatImageMessageContent(p.uri),
    sender: 'me',
    time,
    sortAtMs: item.createdAtMs,
    status: 'sending',
    localMedia,
  };
}

/** Outbox `item.id` is the canonical `client_request_id` sent to `send-message` (matches web merge). */
function outboxRowClientRequestId(m: ThreadMessage): string | null {
  if (isLocalTextMessage(m)) return m.localText.outboxItemId ?? null;
  if (isLocalMediaMessage(m)) return m.localMedia.outboxItemId ?? null;
  return null;
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
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const mediaCardWidth = useMemo(
    () => getAdaptiveChatMediaWidth(windowWidth),
    [windowWidth]
  );
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
  const [showAttachmentTray, setShowAttachmentTray] = useState(false);
  const [showScheduleShare, setShowScheduleShare] = useState(false);
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
  const [photoViewer, setPhotoViewer] = useState<{ initialId: string } | null>(null);
  const [videoViewer, setVideoViewer] = useState<{ uri: string; poster?: string | null } | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioRecorderState = useAudioRecorderState(audioRecorder, 250);
  const voiceRecordStartedAtRef = useRef<number | null>(null);
  const voiceStopIntentRef = useRef<'send' | 'cancel' | null>(null);
  const voiceStopInFlightRef = useRef(false);
  const voiceStartInFlightRef = useRef(false);
  const screenMountedRef = useRef(true);
  const recordingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [voiceReplyHint, setVoiceReplyHint] = useState(false);
  const [expandedPendingClusterKey, setExpandedPendingClusterKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatListRow>>(null);
  const inputRef = useRef<TextInput>(null);
  const [exiting, setExiting] = useState(false);
  const goToMatchesTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const goToMatchesRafRef = useRef<number | null>(null);
  const goToMatchesInteractionRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

  const clearGoToMatchesScheduled = useCallback(() => {
    for (const t of goToMatchesTimersRef.current) clearTimeout(t);
    goToMatchesTimersRef.current = [];
    if (goToMatchesRafRef.current != null) {
      cancelAnimationFrame(goToMatchesRafRef.current);
      goToMatchesRafRef.current = null;
    }
    goToMatchesInteractionRef.current?.cancel();
    goToMatchesInteractionRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearGoToMatchesScheduled();
    },
    [clearGoToMatchesScheduled],
  );

  const stickToBottomRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  /** Until first content-size snap for this thread, ignore scroll race that clears stickToBottom before scrollToEnd. */
  const pendingThreadBottomSnapRef = useRef(false);
  const lastThreadCountRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelowCue, setNewBelowCue] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const { show: showAppDialog, dialog: appDialog } = useVibelyDialog();

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(
    () => () => {
      screenMountedRef.current = false;
      voiceStartInFlightRef.current = false;
    },
    [],
  );

  useEffect(
    () => () => {
      if (voiceStopInFlightRef.current && voiceStopIntentRef.current === 'send') return;
      if (!recordingRef.current && !audioRecorder.isRecording) return;
      voiceStopIntentRef.current = 'cancel';
      voiceRecordStartedAtRef.current = null;
      void audioRecorder
        .stop()
        .then(() => discardTemporaryVoiceUri(audioRecorder.uri))
        .catch(() => undefined);
    },
    [audioRecorder],
  );

  useEffect(() => {
    if (!exiting) return;
    if (voiceStopInFlightRef.current && voiceStopIntentRef.current === 'send') return;
    if (!recordingRef.current && !audioRecorder.isRecording) return;

    voiceStopInFlightRef.current = true;
    voiceStopIntentRef.current = 'cancel';
    voiceRecordStartedAtRef.current = null;
    void audioRecorder
      .stop()
      .then(() => discardTemporaryVoiceUri(audioRecorder.uri))
      .catch(() => undefined)
      .finally(() => {
        voiceStopIntentRef.current = null;
        voiceStopInFlightRef.current = false;
      });
  }, [audioRecorder, exiting]);

  /** Render-null instantly so the chat panel disappears, dismiss the stack, replace to matches, and unconditionally repeat at 300ms via a still-mounted watchdog. The cleanup effect cancels the timer on real unmount. */
  const goToMatches = useCallback(() => {
    setExiting(true);
    clearGoToMatchesScheduled();

    try { router.dismissAll(); } catch { /* dismissAll fails on cold deep link with empty stack */ }
    try { router.dismissTo(MATCHES_TAB_HREF); } catch { /* same */ }
    try { router.replace(MATCHES_TAB_HREF); } catch { /* replace can fail during rapid transitions */ }

    const repeatExit = () => {
      try { router.dismissAll(); } catch { /* noop */ }
      try { router.replace(MATCHES_TAB_HREF); } catch { /* noop */ }
    };

    goToMatchesRafRef.current = requestAnimationFrame(() => {
      goToMatchesRafRef.current = null;
      repeatExit();
    });
    goToMatchesTimersRef.current.push(
      setTimeout(repeatExit, 150),
      setTimeout(repeatExit, 300),
    );

    goToMatchesInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      goToMatchesInteractionRef.current = null;
      repeatExit();
    });
  }, [clearGoToMatchesScheduled]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goToMatches();
        return true;
      });
      return () => {
        subscription.remove();
        clearGoToMatchesScheduled();
      };
    }, [goToMatches, clearGoToMatchesScheduled])
  );

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
    const serverClientIds = new Set<string>();
    for (const m of server) {
      const cid = clientRequestIdFromStructured(m.structuredPayload ?? null);
      if (cid) serverClientIds.add(cid);
    }
    const locals = outboxThreadMessages.filter((row) => {
      const cid = outboxRowClientRequestId(row);
      if (!cid) return true;
      return !serverClientIds.has(cid);
    });
    const merged = [...server, ...locals];
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
      if (isLocalMediaMessage(m) && m.localMedia.payload.kind === 'image') {
        out.push({ id: m.id, uri: m.localMedia.payload.uri });
        continue;
      }
      const kind = threadMessageMediaKind(m);
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

  const isListUserScrollIntentActive = useCallback(() => {
    return Date.now() < userScrollIntentUntilRef.current;
  }, []);

  const scrollListToEnd = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  const markListUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current = Date.now() + 1000;
    stickToBottomRef.current = false;
  }, []);

  const settleListUserScrollIntent = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const dist = Math.max(0, contentSize.height - layoutMeasurement.height - contentOffset.y);
    const atBottom = dist < 100;
    stickToBottomRef.current = atBottom;
    setAwayFromBottom(dist > 140);
    if (atBottom) {
      setNewBelowCue(false);
      userScrollIntentUntilRef.current = 0;
    } else {
      userScrollIntentUntilRef.current = Date.now() + 450;
    }
  }, []);

  const listOnScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const dist = Math.max(0, contentSize.height - layoutMeasurement.height - contentOffset.y);
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
      userScrollIntentUntilRef.current = 0;
      scrollListToEnd(false);
      return;
    }
    if (!stickToBottomRef.current) return;
    if (isListUserScrollIntentActive()) return;
    scrollListToEnd(false);
  }, [displayMessages.length, isListUserScrollIntentActive, scrollListToEnd, shellLoading]);

  useEffect(() => {
    if (!scrollAnchorKey) return;
    if (!stickToBottomRef.current) return;
    if (isListUserScrollIntentActive()) return;
    scrollListToEnd(true);
  }, [isListUserScrollIntentActive, scrollAnchorKey, scrollListToEnd]);

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
    userScrollIntentUntilRef.current = 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVibeClipSendSheet]);

  useEffect(() => {
    if (!showDateSheet || dateComposerLaunchSource !== 'vibe_clip') return;
    trackVibeClipEvent('clip_date_flow_opened', {
      launched_from: 'clip_context',
      thread_bucket: threadBucketFromCount(displayMessages.length),
    });
    // Intentionally omit displayMessages.length: this event is keyed to opening the date flow, not live thread updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const k = threadMessageMediaKind(m);
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

  const markReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleMarkThreadRead = useCallback(() => {
    const mid = data?.matchId;
    const uid = user?.id;
    if (!mid || !otherUserId || !uid) return;
    if (markReadTimeoutRef.current) clearTimeout(markReadTimeoutRef.current);
    markReadTimeoutRef.current = setTimeout(() => {
      markReadTimeoutRef.current = null;
      markMatchMessagesRead(mid)
        .then(() => {
          const key = threadMessagesQueryKey(otherUserId, uid);
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
          queryClient.invalidateQueries({ queryKey: ['unread-home'] });
          queryClient.invalidateQueries({ queryKey: ['unread-home-info-bar'] });
        })
        .catch(() => {});
    }, 400);
  }, [data?.matchId, otherUserId, user?.id, queryClient]);

  useFocusEffect(
    useCallback(() => {
      scheduleMarkThreadRead();
      return () => {
        if (markReadTimeoutRef.current) {
          clearTimeout(markReadTimeoutRef.current);
          markReadTimeoutRef.current = null;
        }
      };
    }, [scheduleMarkThreadRead])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') scheduleMarkThreadRead();
    });
    return () => sub.remove();
  }, [scheduleMarkThreadRead]);

  useEffect(() => {
    scheduleMarkThreadRead();
    return () => {
      if (markReadTimeoutRef.current) {
        clearTimeout(markReadTimeoutRef.current);
        markReadTimeoutRef.current = null;
      }
    };
  }, [scheduleMarkThreadRead]);

  const {
    startCall,
  } = useMatchCall({
    matchId: data?.matchId ?? matchRowEarly?.matchId ?? null,
    currentUserId: user?.id ?? null,
    partnerUserId: otherUserId ?? null,
    partnerName: data?.otherUser?.name ?? matchRowEarly?.name ?? 'Chat',
    partnerAvatarUri: (() => {
      const primaryPhotoPath = resolvePrimaryProfilePhotoPath({
        photos: data?.otherUser?.photos,
        avatar_url: data?.otherUser?.avatar_url,
      });
      if (primaryPhotoPath) return avatarUrl(primaryPhotoPath);
      if (matchRowEarly?.image) return avatarUrl(matchRowEarly.image);
      return null;
    })(),
  });

  const isOffline = useConnectivity() === 'offline';

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setIsTyping(!!text.trim());
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000);
  }, []);
  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  const otherName = otherUserId ? (matches.find((m) => m.id === otherUserId)?.name ?? 'Chat') : 'Chat';
  const otherUser = data?.otherUser ?? null;
  const [showActions, setShowActions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [pendingUnmatchMatchId, setPendingUnmatchMatchId] = useState<string | null>(null);
  const [pendingUnmatchName, setPendingUnmatchName] = useState('');
  const undoableUnmatchCallbacks = useMemo(
    () => ({
      onUnmatchComplete: () => {
        setPendingUnmatchMatchId(null);
        setPendingUnmatchName('');
        goToMatches();
      },
      onUndo: () => {
        setPendingUnmatchMatchId(null);
        setPendingUnmatchName('');
      },
    }),
    [goToMatches],
  );
  const { initiateUnmatch, cancelPending } = useUndoableUnmatch(undoableUnmatchCallbacks);
  const { blockUser } = useBlockUser(user?.id);
  const { archiveMatch, unarchiveMatch } = useArchiveMatch(user?.id);
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch(user?.id);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const currentMatchRow = data?.matchId ? matches.find((m) => m.matchId === data.matchId) : null;
  const matchForActions =
    data?.matchId && otherUserId
      ? {
          matchId: data.matchId,
          id: otherUserId,
          name: otherName,
          archived_at: currentMatchRow?.archived_at ?? null,
          bunnyVideoUid: data.otherUser?.bunny_video_uid ?? currentMatchRow?.bunnyVideoUid ?? null,
        }
      : shellLoading && matchRowEarly && otherUserId
        ? {
            matchId: matchRowEarly.matchId,
            id: otherUserId,
            name: otherName,
            archived_at: matchRowEarly.archived_at ?? null,
            bunnyVideoUid: currentMatchRow?.bunnyVideoUid ?? null,
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
    if (recording || voiceStopInFlightRef.current || voiceStartInFlightRef.current) return;
    voiceStartInFlightRef.current = true;
    setVoiceError(null);
    voiceStopIntentRef.current = null;
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) throw new Error('Permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      if (!screenMountedRef.current) return;
      voiceRecordStartedAtRef.current = Date.now();
      audioRecorder.record();
      if (!screenMountedRef.current) {
        voiceRecordStartedAtRef.current = null;
        await audioRecorder.stop().catch(() => undefined);
        await discardTemporaryVoiceUri(audioRecorder.uri);
        return;
      }
      setRecording(true);
      setShowAttachmentTray(false);
    } catch (e) {
      voiceRecordStartedAtRef.current = null;
      voiceStopIntentRef.current = null;
      if (!screenMountedRef.current) return;
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
    } finally {
      voiceStartInFlightRef.current = false;
    }
  };

  const cancelVoiceRecording = async (opts?: { silent?: boolean }) => {
    if (voiceStopInFlightRef.current) return;
    voiceStopInFlightRef.current = true;
    voiceStopIntentRef.current = 'cancel';
    setRecording(false);
    setVoiceError(null);
    voiceRecordStartedAtRef.current = null;

    try {
      if (audioRecorder.isRecording || recordingRef.current) {
        await audioRecorder.stop();
      }
      await discardTemporaryVoiceUri(audioRecorder.uri);
      if (!opts?.silent) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      await discardTemporaryVoiceUri(audioRecorder.uri);
    } finally {
      voiceStopIntentRef.current = null;
      voiceStopInFlightRef.current = false;
    }
  };

  const stopVoiceRecordingAndSend = async () => {
    if (voiceStopInFlightRef.current) return;
    if (!data?.matchId || !user?.id) {
      await cancelVoiceRecording({ silent: true });
      return;
    }
    voiceStopInFlightRef.current = true;
    voiceStopIntentRef.current = 'send';
    setRecording(false);
    try {
      await audioRecorder.stop();
      if (voiceStopIntentRef.current !== 'send') {
        await discardTemporaryVoiceUri(audioRecorder.uri);
        return;
      }
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
      const queuedId = enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: { kind: 'voice', uri: stable, durationSeconds: durationSec },
      });
      if (queuedId && stable !== uri) {
        await discardTemporaryVoiceUri(uri);
      }
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
    } finally {
      voiceRecordStartedAtRef.current = null;
      voiceStopIntentRef.current = null;
      voiceStopInFlightRef.current = false;
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
    stickToBottomRef.current = true;
    userScrollIntentUntilRef.current = 0;
    scrollListToEnd(true);
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
        shouldDownloadFromNetwork: true,
        videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!isPickedVideoAsset(asset)) throw new Error(VIBE_CLIP_UPLOAD_INVALID_TYPE);
      const durationSec = imagePickerDurationSeconds(asset);
      if (durationSec == null) throw new Error(VIBE_CLIP_UPLOAD_DURATION_UNREADABLE);
      if (durationSec > VIBE_CLIP_MAX_DURATION_SEC + 0.25) {
        throw new Error(VIBE_CLIP_UPLOAD_TOO_LONG());
      }
      trackVibeClipEvent('clip_record_completed', {
        capture_source: 'library',
        duration_bucket: durationBucketFromSeconds(durationSec),
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? undefined));
      const sizeBytes = await fileSizeBytesForVideoAsset(asset, stable);
      if (sizeBytes === 0) {
        await cleanupOutboxCacheUri(stable);
        throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
      }
      if (typeof sizeBytes === 'number' && sizeBytes > VIBE_CLIP_MAX_UPLOAD_BYTES) {
        await cleanupOutboxCacheUri(stable);
        throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());
      }
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: Math.max(1, Math.round(durationSec)),
          mimeType: asset.mimeType ?? undefined,
          aspectRatio: aspectRatioForVideoAsset(asset),
        },
      });
      trackVibeClipEvent('clip_send_attempted', {
        capture_source: 'library',
        duration_bucket: durationBucketFromSeconds(durationSec),
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
        cameraType: ImagePicker.CameraType.front,
        videoMaxDuration: VIBE_CLIP_MAX_DURATION_SEC,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!isPickedVideoAsset(asset)) throw new Error(VIBE_CLIP_UPLOAD_INVALID_TYPE);
      const durationSec = imagePickerDurationSeconds(asset);
      if (durationSec != null && durationSec > VIBE_CLIP_MAX_DURATION_SEC + 0.25) {
        throw new Error(VIBE_CLIP_UPLOAD_TOO_LONG());
      }
      trackVibeClipEvent('clip_record_completed', {
        capture_source: 'camera',
        duration_bucket: durationBucketFromSeconds(durationSec),
        thread_bucket: threadBucketFromCount(displayMessages.length),
        is_sender: true,
      });
      const stable = await copyUriToChatOutboxCache(asset.uri, extForPayload('video', asset.mimeType ?? 'video/mp4'));
      const sizeBytes = await fileSizeBytesForVideoAsset(asset, stable);
      if (sizeBytes === 0) {
        await cleanupOutboxCacheUri(stable);
        throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
      }
      if (typeof sizeBytes === 'number' && sizeBytes > VIBE_CLIP_MAX_UPLOAD_BYTES) {
        await cleanupOutboxCacheUri(stable);
        throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());
      }
      void enqueue({
        matchId: data.matchId,
        otherUserId: otherUserId ?? '',
        payload: {
          kind: 'video',
          uri: stable,
          durationSeconds: durationSec != null ? Math.max(1, Math.round(durationSec)) : 1,
          mimeType: asset.mimeType ?? 'video/mp4',
          aspectRatio: aspectRatioForVideoAsset(asset),
        },
      });
      trackVibeClipEvent('clip_send_attempted', {
        capture_source: 'camera',
        duration_bucket: durationBucketFromSeconds(durationSec),
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
    setShowAttachmentTray(false);
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
    setShowAttachmentTray(false);
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
    setShowAttachmentTray(false);
    setShowGamesPicker(true);
  };

  const openScheduleShare = () => {
    if (shellLoading || !data?.matchId) return;
    setShowAttachmentTray(false);
    setShowScheduleShare(true);
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

  const openOtherProfile = useCallback(() => {
    if (!otherUserId) return;
    const matchId = data?.matchId ?? matchRowEarly?.matchId;
    const query = matchId ? `?matchId=${encodeURIComponent(matchId)}` : '';
    (router as { push: (p: string) => void }).push(`/user/${encodeURIComponent(otherUserId)}${query}`);
  }, [data?.matchId, matchRowEarly?.matchId, otherUserId]);

  if (!otherUserId || !user?.id) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Invalid chat"
            message="This conversation could not be loaded."
            actionLabel="Go back"
            onActionPress={goToMatches}
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
            onActionPress={goToMatches}
          />
        </View>
        {appDialog}
      </>
    );
  }

  const otherAvatarUri = otherUser
    ? (() => {
        const primaryPhotoPath = resolvePrimaryProfilePhotoPath({
          photos: otherUser.photos,
          avatar_url: otherUser.avatar_url,
        });
        return primaryPhotoPath ? avatarUrl(primaryPhotoPath) : null;
      })()
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
  const voiceRecordingSeconds = recording
    ? Math.max(
        Math.round((audioRecorderState.durationMillis ?? 0) / 1000),
        voiceRecordStartedAtRef.current != null
          ? Math.floor((Date.now() - voiceRecordStartedAtRef.current) / 1000)
          : 0,
      )
    : 0;

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
    const mediaKind = threadMessageMediaKind(item);
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
        <View style={[styles.voiceContentWrap, { width: mediaCardWidth }]}>
          <VoiceMessagePlayer
            uri={item.audio_url}
            sourceRef={item.audio_source_ref}
            messageId={item.id}
            durationSeconds={item.audio_duration_seconds}
            isMine={isMe}
            theme={theme}
            wrapStyle={[styles.voicePlayerWrap, { width: mediaCardWidth }]}
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
          <View style={[styles.mediaContentWrap, { width: mediaCardWidth }]}>
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
        <View style={[styles.mediaContentWrap, { width: mediaCardWidth }]}>
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
        <View style={[styles.mediaContentWrap, { width: mediaCardWidth }]}>
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
    const mediaKind = threadMessageMediaKind(msg);
    const isMediaBubble = mediaKind === 'video' || mediaKind === 'image' || mediaKind === 'vibe_clip';
    const prevKind = prev ? threadMessageMediaKind(prev) : 'text';
    const nextKind = next ? threadMessageMediaKind(next) : 'text';
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

  if (exiting) return null;

  return (
    <View style={[styles.container, { backgroundColor: CHAT_CANVAS_BG }]}>
      <View style={[styles.headerOuter, { paddingTop: insets.top, backgroundColor: CHAT_CANVAS_BG }]}>
        <View style={[styles.headerCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <Pressable
            onPress={goToMatches}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <Pressable
              onPress={openOtherProfile}
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

      {matchForActions && (
        <>
          <MatchActionsSheet
            visible={showActions}
            onClose={() => setShowActions(false)}
            matchName={matchForActions.name}
            onViewProfile={() => {
              setShowActions(false);
              openOtherProfile();
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
                message: `Remove ${matchForActions.name} from your matches? You’ll have a few seconds to undo.`,
                variant: 'destructive',
                primaryAction: {
                  label: 'Unmatch',
                  onPress: () => {
                    setPendingUnmatchMatchId(matchForActions.matchId);
                    setPendingUnmatchName(matchForActions.name);
                    initiateUnmatch(matchForActions.matchId);
                    setShowActions(false);
                  },
                },
                secondaryAction: { label: 'Cancel', onPress: () => {} },
              });
            }}
            onArchive={async () => {
              showAppDialog({
                title: 'Archive chat?',
                message: `Hide ${matchForActions.name} from your main matches list. You can restore this chat anytime.`,
                variant: 'info',
                primaryAction: {
                  label: 'Archive',
                  onPress: () => {
                    void (async () => {
                      setActionLoading('archive');
                      try {
                        await archiveMatch({ matchId: matchForActions.matchId });
                        setShowActions(false);
                        goToMatches();
                      } finally {
                        setActionLoading(null);
                      }
                    })();
                  },
                },
                secondaryAction: { label: 'Cancel', onPress: () => {} },
              });
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
                        goToMatches();
                      } finally {
                        setActionLoading(null);
                      }
                    })();
                  },
                },
                secondaryAction: { label: 'Cancel', onPress: () => {} },
              });
            }}
            onMute={async (duration: MuteDuration) => {
              setActionLoading('mute');
              try {
                await muteMatch({ matchId: matchForActions.matchId, duration });
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
            onSuccess={({ alsoBlock }) => {
              setShowReport(false);
              queryClient.invalidateQueries({ queryKey: ['matches'] });
              queryClient.invalidateQueries({ queryKey: ['messages'] });
              queryClient.invalidateQueries({ queryKey: ['match-mutes'] });
              queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
              if (alsoBlock) {
                goToMatches();
              }
            }}
            reportedId={matchForActions.id}
            reportedName={matchForActions.name}
            reporterId={user?.id ?? ''}
            sourceSurface="native_chat"
            reportedHasVibeVideo={
              typeof matchForActions.bunnyVideoUid === 'string' &&
              matchForActions.bunnyVideoUid.trim().length > 0
            }
          />
          <UnmatchSnackbar
            visible={!!pendingUnmatchMatchId}
            name={pendingUnmatchName}
            onUndo={() => {
              cancelPending();
              setPendingUnmatchMatchId(null);
              setPendingUnmatchName('');
            }}
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
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={listOnScroll}
          onScrollBeginDrag={markListUserScrollIntent}
          onScrollEndDrag={settleListUserScrollIntent}
          onMomentumScrollBegin={markListUserScrollIntent}
          onMomentumScrollEnd={settleListUserScrollIntent}
          onContentSizeChange={listOnContentSizeChange}
          scrollEventThrottle={16}
          alwaysBounceVertical
          nestedScrollEnabled
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
                userScrollIntentUntilRef.current = 0;
                setAwayFromBottom(false);
                setNewBelowCue(false);
                scrollListToEnd(true);
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
              setShowAttachmentTray(false);
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
          {showAttachmentTray && !recording ? (
            <View
              style={[
                styles.attachmentTray,
                { borderColor: theme.border, backgroundColor: 'rgba(12,12,18,0.92)' },
              ]}
            >
              <Pressable
                onPress={() => openPhotoOptions()}
                disabled={shellLoading || composerInputLocked}
                hitSlop={{ top: 2, bottom: 2 }}
                style={({ pressed }) => [
                  styles.attachmentAction,
                  { backgroundColor: theme.muted, opacity: shellLoading || composerInputLocked ? 0.45 : pressed ? 0.88 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Photo"
              >
                {sendingPhoto ? (
                  <ActivityIndicator size="small" color={theme.tint} />
                ) : (
                  <Ionicons name="camera-outline" size={18} color={theme.textSecondary} />
                )}
                <Text numberOfLines={1} style={[styles.attachmentActionLabel, { color: theme.text }]}>Photo</Text>
              </Pressable>
              <Pressable
                onPress={() => openVideoMessageOptions()}
                disabled={shellLoading || composerInputLocked}
                hitSlop={{ top: 2, bottom: 2 }}
                style={({ pressed }) => [
                  styles.attachmentAction,
                  {
                    backgroundColor: sendingVideo ? 'rgba(139,92,246,0.16)' : theme.muted,
                    opacity: shellLoading || composerInputLocked ? 0.45 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Vibe Clip - record or choose a clip"
              >
                {sendingVideo ? (
                  <ActivityIndicator size="small" color="rgba(139,92,246,1)" />
                ) : (
                  <Ionicons name="film-outline" size={18} color={sendingVideo ? 'rgba(139,92,246,1)' : theme.textSecondary} />
                )}
                <Text numberOfLines={1} style={[styles.attachmentActionLabel, { color: theme.text }]}>Clip</Text>
              </Pressable>
              <Pressable
                onPress={() => openScheduleShare()}
                disabled={shellLoading || !data?.matchId}
                hitSlop={{ top: 2, bottom: 2 }}
                style={({ pressed }) => [
                  styles.attachmentAction,
                  { backgroundColor: theme.muted, opacity: shellLoading || !data?.matchId ? 0.45 : pressed ? 0.88 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Share Vibely Schedule"
              >
                <Ionicons name="calendar-outline" size={18} color={theme.neonCyan} />
                <Text numberOfLines={1} style={[styles.attachmentActionLabel, { color: theme.text }]}>Schedule</Text>
              </Pressable>
            </View>
          ) : null}
          {recording ? (
            <View
              style={[
                styles.voiceRecordingBar,
                {
                  borderColor: 'rgba(236,72,153,0.24)',
                  backgroundColor: 'rgba(14,14,20,0.96)',
                },
              ]}
            >
              <Pressable
                onPress={() => void cancelVoiceRecording()}
                style={({ pressed }) => [
                  styles.voiceRecordingControl,
                  {
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Discard voice recording"
              >
                <Ionicons name="trash-outline" size={20} color={theme.textSecondary} />
              </Pressable>

              <View style={styles.voiceRecordingCenter}>
                <View style={styles.voiceRecordingMetaRow}>
                  <View style={styles.voiceRecordingState}>
                    <View style={[styles.voiceRecordingDot, { backgroundColor: theme.neonPink }]} />
                    <Text numberOfLines={1} style={[styles.voiceRecordingLabel, { color: theme.text }]}>
                      Recording
                    </Text>
                  </View>
                  <Text style={[styles.voiceRecordingTimer, { color: theme.text }]}>
                    {formatVoiceRecordingDuration(voiceRecordingSeconds)}
                  </Text>
                </View>
                <View style={styles.voiceRecordingWaveform} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {VOICE_RECORDING_BARS.map((level, index) => {
                    const isLifted = (voiceRecordingSeconds + index) % 3 === 0;
                    return (
                      <View
                        key={`voice-recording-bar-${index}`}
                        style={[
                          styles.voiceRecordingWaveBar,
                          {
                            height: 8 + level * 24 + (isLifted ? 5 : 0),
                            backgroundColor: index % 2 === 0 ? 'rgba(236,72,153,0.78)' : 'rgba(168,85,247,0.72)',
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              </View>

              <Pressable
                onPress={() => void stopVoiceRecordingAndSend()}
                style={({ pressed }) => [
                  styles.voiceRecordingSend,
                  {
                    backgroundColor: theme.tint,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send voice recording"
              >
                <Ionicons name="arrow-up" size={22} color={theme.primaryForeground} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.composerDockRow}>
              <Pressable
                style={[styles.composerIconBtn, { backgroundColor: theme.muted }]}
                onPress={() => setShowAttachmentTray((open) => !open)}
                disabled={shellLoading || !data?.matchId}
                accessibilityLabel={showAttachmentTray ? 'Close attachments' : 'Open attachments'}
                accessibilityState={{ expanded: showAttachmentTray, disabled: shellLoading || !data?.matchId }}
              >
                <Ionicons name={showAttachmentTray ? 'close' : 'add'} size={24} color={theme.textSecondary} />
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
                    backgroundColor: voiceReplyHint ? 'rgba(139,92,246,0.18)' : theme.muted,
                  },
                  voiceReplyHint && { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(139,92,246,0.5)' },
                ]}
                onPress={handleVoicePress}
                disabled={shellLoading || composerInputLocked}
                accessibilityLabel="Voice message"
              >
                {sendingVoice ? (
                  <ActivityIndicator size="small" color={theme.tint} />
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
          )}
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
      {data?.matchId ? (
        <ScheduleShareSheet
          visible={showScheduleShare}
          onClose={() => setShowScheduleShare(false)}
          matchId={data.matchId}
          partnerName={otherName}
          onActiveSuggestionConflict={() => {
            onDateSuggestionUpdated();
            setShowActiveDateSuggestionWarning(true);
          }}
          onSent={() => onDateSuggestionUpdated()}
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
          counterContext={composerCounter}
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
  backBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: spacing.xs },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerIconBtn: {
    padding: 8,
    borderRadius: 12,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 44 },
  headerAvatar: { width: 44, height: 44, borderRadius: 22 },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerAvatarLetter: { fontSize: 16, fontWeight: '600' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  /** Fixed min height so header does not jump when subtitle is null (web `min-h-4` parity). */
  headerSubtitleSlot: { minHeight: 14, justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, marginTop: 2, opacity: 0.95 },
  typingWrap: { paddingVertical: spacing.sm },
  reactionBadge: { fontSize: 14, marginTop: 4 },
  mediaContentWrap: { maxWidth: '100%', minWidth: MEDIA_CARD_MIN_WIDTH },
  mediaMetaBlock: { marginTop: 6, width: '100%', minWidth: 0, alignSelf: 'stretch' },
  voiceContentWrap: { maxWidth: '100%', minWidth: MEDIA_CARD_MIN_WIDTH },
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
    gap: COMPOSER_GAP,
  },
  voiceRecordingBar: {
    minHeight: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceRecordingControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceRecordingCenter: {
    flex: 1,
    minWidth: 0,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  voiceRecordingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  voiceRecordingState: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  voiceRecordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  voiceRecordingLabel: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  voiceRecordingTimer: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  voiceRecordingWaveform: {
    marginTop: 7,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    overflow: 'hidden',
  },
  voiceRecordingWaveBar: {
    width: 4,
    borderRadius: 999,
    minHeight: 8,
  },
  voiceRecordingSend: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentTray: {
    flexDirection: 'row',
    gap: COMPOSER_GAP,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 4,
    marginBottom: spacing.sm,
  },
  attachmentAction: {
    flex: 1,
    minWidth: 0,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  attachmentActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  composerIconBtn: {
    width: COMPOSER_CONTROL_SIZE,
    height: COMPOSER_CONTROL_SIZE,
    borderRadius: COMPOSER_CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputDock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: COMPOSER_CONTROL_SIZE / 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_CONTROL_SIZE,
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  sendFab: {
    width: COMPOSER_CONTROL_SIZE,
    height: COMPOSER_CONTROL_SIZE,
    borderRadius: COMPOSER_CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
  voicePlayerWrap: { minWidth: MEDIA_CARD_MIN_WIDTH, width: '100%', maxWidth: '100%' },
  chatVideoCardOuter: {
    width: '100%',
    maxWidth: '100%',
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
    maxWidth: '100%',
    minWidth: MEDIA_CARD_MIN_WIDTH,
  },
  chatImage: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  voiceError: { fontSize: 12, marginTop: spacing.sm, alignSelf: 'center', textAlign: 'center', paddingHorizontal: spacing.md },
});
