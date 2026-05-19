import { lazy, Suspense, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import * as Sentry from "@sentry/react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Film,
  Camera,
  Loader2,
  CalendarDays,
  CalendarPlus,
  Gamepad2,
  Phone,
  ChevronDown,
  Plus,
  Video,
  X,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader, type ChatHeaderActivityLine } from "@/components/chat/ChatHeader";
import { ProfileDetailDrawer } from "@/components/ProfileDetailDrawer";
import { ChatThreadSkeleton } from "@/components/chat/ChatThreadSkeleton";
import { VoiceMessageBubble } from "@/components/chat/VoiceMessageBubble";
import { VideoMessageBubble } from "@/components/chat/VideoMessageBubble";
import { VibeClipBubble, type VibeClipLocalRecovery } from "@/components/chat/VibeClipBubble";
import { MessageStatus } from "@/components/chat/MessageStatus";
import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageMessageContent,
} from "@/lib/chatMessageContent";
import { refreshCachedChatMediaUrl } from "@/lib/chatMediaResolver";
import { extractVibeClipMeta } from "../../shared/chat/messageRouting";
import { clientRequestIdFromStructured } from "../../shared/chat/clientRequestId";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DateSuggestionCard } from "@/components/chat/DateSuggestionCard";
import { ActiveDateSuggestionWarningDialog } from "@/components/chat/ActiveDateSuggestionWarningDialog";
import { useMatchDateSuggestions } from "@/hooks/useDateSuggestionData";
import type { DateSuggestionWithRelations } from "@/hooks/useDateSuggestionData";
import type { WizardState } from "@/components/chat/DateSuggestionComposer";
import { GameBubbleRenderer } from "@/components/arcade/GameBubbleRenderer";
import { GameType, GameMessage, GamePayload } from "@/types/games";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { useRealtimeDateScheduleState } from "@/hooks/useRealtimeDateScheduleState";
import { useTypingBroadcast } from "@/hooks/useTypingBroadcast";
import { useMessageReactions } from "@/hooks/useMessageReactions";
import { useMessages } from "@/hooks/useMessages";
import { useWebChatOutbox } from "@/contexts/WebChatOutboxContext";
import { putOutboxBlob, getOutboxBlob } from "@/lib/webChatOutbox/blobIdb";
import { webOutboxItemsToRows, type OutboxPreviewMap } from "@/lib/webChatOutbox/toChatMessages";
import type { WebChatOutboxItem } from "@/lib/webChatOutbox/types";
import { setMessageReaction } from "@/lib/messageReactions";
import { reactionPairFromRows, type ReactionPair, type MessageReactionRow } from "../../shared/chat/messageReactionModel";
import { webGamePayloadFromSessionView, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";
import { formatSendGameEventError, newVibeGameSessionId, sendGameEvent } from "@/lib/webGamesApi";
import {
  GENERIC_UPLOAD_MIME_TYPE,
  imageMimeTypeForUpload,
  videoMimeTypeForUpload,
} from "@/lib/webUploadMime";
import { dedupeLatestByRefId } from "../../shared/chat/refDedupe";
import type { DateComposerLaunchSource } from "../../shared/dateSuggestions/dateComposerLaunch";
import { findBlockingDateSuggestion } from "../../shared/dateSuggestions/openStatus";
import {
  VIBE_CLIP_CHAT_FILM_BUTTON_TITLE,
  VIBE_CLIP_MAX_DURATION_SEC,
  VIBE_CLIP_MAX_SOURCE_BYTES,
  VIBE_CLIP_SOFT_SOURCE_BYTES,
  VIBE_CLIP_TOAST_SEND_FAIL,
  VIBE_CLIP_TOAST_SENT,
  VIBE_CLIP_TOAST_UPLOAD_FAIL,
  VIBE_CLIP_UPLOAD_LARGE_SOFT_WARNING,
  VIBE_CLIP_UPLOAD_INVALID_TYPE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
  VIBE_CLIP_UPLOAD_TOO_LONG,
} from "../../shared/chat/vibeClipCaptureCopy";
import {
  classifySendFailureMessage,
  durationBucketFromSeconds,
  threadBucketFromCount,
  type CaptureSource,
} from "../../shared/chat/vibeClipAnalytics";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { useUserProfile } from "@/contexts/AuthContext";
import { useMatchCall } from "@/hooks/useMatchCall";
import { threadMessagesQueryKey } from "../../shared/chat/queryKeys";
import { format } from "date-fns";
import { buildThreadPresentationRows } from "../../shared/chat/threadPresentation";
import { resolvePrimaryProfilePhotoPath } from "../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import { avatarUrl, getImageUrl } from "@/utils/imageUrl";

type MessageStatusType = "sending" | "sent" | "delivered" | "read";
type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

const DATE_SUGGESTION_KEYWORDS = ["free", "video", "call", "meet", "date", "tonight", "later", "available"];
const CHAT_COMPOSER_CONTROL_CLASS = "h-10 w-10";
const CHAT_DESKTOP_VIEWPORT_QUERY = "(min-width: 1024px)";
const CHAT_MOBILE_KEYBOARD_THRESHOLD_PX = 96;
const CHAT_MOBILE_KEYBOARD_STYLE_CLEAR_DELAY_MS = 240;
const MATCHES_ROUTE = "/matches";

const VoiceRecorder = lazy(() => import("@/components/chat/VoiceRecorder"));
const VideoMessageRecorder = lazy(() => import("@/components/chat/VideoMessageRecorder"));
const VibeClipSendOptionsSheet = lazy(() => import("@/components/chat/VibeClipSendOptionsSheet"));
const PhotoSendOptionsDialog = lazy(() => import("@/components/chat/PhotoSendOptionsDialog"));
const PhotoCameraCaptureDialog = lazy(() => import("@/components/chat/PhotoCameraCaptureDialog"));
const ChatPhotoLightbox = lazy(() =>
  import("@/components/chat/ChatPhotoLightbox").then((mod) => ({ default: mod.ChatPhotoLightbox })),
);
const ChatVideoLightbox = lazy(() =>
  import("@/components/chat/ChatVideoLightbox").then((mod) => ({ default: mod.ChatVideoLightbox })),
);
const ScheduleShareSheet = lazy(() =>
  import("@/components/chat/ScheduleShareSheet").then((mod) => ({ default: mod.ScheduleShareSheet })),
);
const ScheduleShareEditSheet = lazy(() =>
  import("@/components/chat/ScheduleShareEditSheet").then((mod) => ({ default: mod.ScheduleShareEditSheet })),
);
const DateSuggestionComposer = lazy(() =>
  import("@/components/chat/DateSuggestionComposer").then((mod) => ({ default: mod.DateSuggestionComposer })),
);
const VibeArcadeMenu = lazy(() =>
  import("@/components/arcade/VibeArcadeMenu").then((mod) => ({ default: mod.VibeArcadeMenu })),
);
const TwoTruthsCreator = lazy(() =>
  import("@/components/arcade/creators/TwoTruthsCreator").then((mod) => ({ default: mod.TwoTruthsCreator })),
);
const WouldRatherCreator = lazy(() =>
  import("@/components/arcade/creators/WouldRatherCreator").then((mod) => ({ default: mod.WouldRatherCreator })),
);
const CharadesCreator = lazy(() =>
  import("@/components/arcade/creators/CharadesCreator").then((mod) => ({ default: mod.CharadesCreator })),
);
const ScavengerCreator = lazy(() =>
  import("@/components/arcade/creators/ScavengerCreator").then((mod) => ({ default: mod.ScavengerCreator })),
);
const RouletteCreator = lazy(() =>
  import("@/components/arcade/creators/RouletteCreator").then((mod) => ({ default: mod.RouletteCreator })),
);
const IntuitionCreator = lazy(() =>
  import("@/components/arcade/creators/IntuitionCreator").then((mod) => ({ default: mod.IntuitionCreator })),
);

interface ChatMessage {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  type: "text" | "image" | "voice" | "video" | "vibe_clip" | "date-suggestion" | "date-suggestion-event" | "vibe-game-session";
  duration?: number;
  audioBlob?: Blob;
  audioUrl?: string;
  audioSourceRef?: string;
  audioDuration?: number;
  imageSourceRef?: string;
  videoUrl?: string;
  videoSourceRef?: string;
  videoDuration?: number;
  thumbnailSourceRef?: string;
  reactionPair?: ReactionPair | null;
  status?: MessageStatusType;
  sendError?: string;
  refId?: string | null;
  structuredPayload?: Record<string, unknown> | null;
  gameSessionView?: WebHydratedGameSessionView;
  /** Epoch ms for ordering merged thread (server: created_at; optimistic: send time) */
  sortAtMs?: number;
  /** Matches structured_payload.client_request_id on the server row after send */
  clientRequestId?: string;
  /** Durable web outbox row id for retry */
  outboxItemId?: string;
  /** Secondary line under timestamp (queued / offline / uploading) */
  statusSubtext?: string;
}

type ChatVideoLightboxState = {
  url: string;
  posterUrl?: string | null;
  messageId?: string;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  mediaKind?: "video" | "vibe_clip";
};

/** Merge server rows with optimistic locals: drop locals once server echoes the same client_request_id; sort by send time */
function mergeServerAndLocalChatMessages(realMsgs: ChatMessage[], localMessages: ChatMessage[]): ChatMessage[] {
  const serverClientIds = new Set<string>();
  for (const m of realMsgs) {
    const cid = clientRequestIdFromStructured(m.structuredPayload);
    if (cid) serverClientIds.add(cid);
  }
  const locals = localMessages.filter((l) => !(l.clientRequestId && serverClientIds.has(l.clientRequestId)));
  return [...realMsgs, ...locals].sort((a, b) => {
    const t = (a.sortAtMs ?? 0) - (b.sortAtMs ?? 0);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

type TextMessage = ChatMessage & { type: "text" };

function vibeClipRecoveryForOutboxItem(
  item: WebChatOutboxItem | undefined,
  sendError: string | undefined,
  onResume?: () => void,
  onDiscardAndSendAgain?: () => void,
): VibeClipLocalRecovery | null {
  if (!item || item.payload.kind !== "video") return null;
  const canResume = item.state === "failed" || item.state === "waiting_for_network";
  const canDiscard = item.state !== "sending" && item.state !== "awaiting_hydration";
  const uploadPercent =
    item.state === "sending" &&
    typeof item.uploadProgress === "number" &&
    Number.isFinite(item.uploadProgress)
      ? Math.max(0, Math.min(100, Math.round(item.uploadProgress * 100)))
      : null;
  const stateLabel = sendError ??
    (uploadPercent != null
      ? `Uploading ${uploadPercent}%`
      : item.state === "awaiting_hydration"
        ? "Uploaded. Waiting for the message to appear."
        : item.state === "waiting_for_network"
          ? "Upload paused until you're back online."
          : item.state === "failed"
            ? "Upload needs attention."
            : "Upload is queued.");

  return {
    stateLabel,
    error: sendError,
    canResume,
    canDiscard,
    onResume,
    onDiscardAndSendAgain,
  };
}

function VibeClipMessageRow({
  message,
  otherUser,
  onReplyWithClip,
  onVoiceReply,
  onSuggestDate,
  onReactionPick,
  threadMessageCount,
  immersiveVideoUrl,
  onRequestImmersiveVideo,
  videoUrlOverride,
  thumbnailUrlOverride,
  onResolvedVideoUrl,
  onResolvedThumbnailUrl,
  threadVisualRecede,
  localOutboxItem,
  onResumeOutbox,
  onDiscardOutboxAndSendAgain,
}: {
  message: ChatMessage & { isFirstInGroup?: boolean; isLastInGroup?: boolean; showAvatar?: boolean };
  otherUser: { avatar_url: string | null } | null;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
  onSuggestDate?: () => void;
  onReactionPick?: (emoji: ReactionEmoji) => void;
  threadMessageCount: number;
  immersiveVideoUrl: string | null;
  onRequestImmersiveVideo: (viewer: ChatVideoLightboxState) => void;
  videoUrlOverride?: string;
  thumbnailUrlOverride?: string | null;
  onResolvedVideoUrl?: (messageId: string, url: string) => void;
  onResolvedThumbnailUrl?: (messageId: string, url: string) => void;
  threadVisualRecede?: boolean;
  localOutboxItem?: WebChatOutboxItem;
  onResumeOutbox?: () => void;
  onDiscardOutboxAndSendAgain?: () => void;
}) {
  const baseClipMeta = extractVibeClipMeta({
    video_url: message.videoUrl,
    video_duration_seconds: message.videoDuration,
    structured_payload: (message.structuredPayload as Record<string, unknown>) ?? null,
    message_kind: "vibe_clip",
  });
  const clipMeta = baseClipMeta
    ? {
        ...baseClipMeta,
        videoUrl: videoUrlOverride ?? baseClipMeta.videoUrl,
        thumbnailUrl: thumbnailUrlOverride ?? baseClipMeta.thumbnailUrl,
      }
    : null;
  const isMine = message.sender === "me";
  const localRecovery = vibeClipRecoveryForOutboxItem(
    localOutboxItem,
    message.sendError,
    onResumeOutbox,
    onDiscardOutboxAndSendAgain,
  );
  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isMine ? "justify-end" : "justify-start",
        message.isFirstInGroup ? "mt-2" : "mt-1"
      )}
    >
      {!isMine && (
        <div className="w-7 shrink-0">
          {message.showAvatar && otherUser?.avatar_url && (
            <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
          )}
        </div>
      )}
      <div>
        {clipMeta ? (
          <VibeClipBubble
            meta={clipMeta}
            isMine={isMine}
            videoSourceRef={message.videoSourceRef}
            thumbnailSourceRef={message.thumbnailSourceRef}
            onResolvedVideoUrl={(url) => onResolvedVideoUrl?.(message.id, url)}
            onResolvedThumbnailUrl={(url) => onResolvedThumbnailUrl?.(message.id, url)}
            threadMessageCount={threadMessageCount}
            sparkMessageId={message.id}
            onReplyWithClip={isMine ? undefined : onReplyWithClip}
            onVoiceReply={isMine ? undefined : onVoiceReply}
            onSuggestDate={isMine ? undefined : onSuggestDate}
            onReactionPick={isMine ? undefined : onReactionPick}
            reactionPair={message.reactionPair}
            onRequestImmersive={() =>
              onRequestImmersiveVideo({
                url: clipMeta.videoUrl,
                posterUrl: clipMeta.thumbnailUrl ?? null,
                messageId: message.id,
                videoSourceRef: message.videoSourceRef,
                thumbnailSourceRef: message.thumbnailSourceRef,
                mediaKind: "vibe_clip",
              })
            }
            immersiveActive={immersiveVideoUrl === clipMeta.videoUrl}
            threadVisualRecede={threadVisualRecede}
            localRecovery={localRecovery}
          />
        ) : (
          <VideoMessageBubble
            videoUrl={videoUrlOverride ?? message.videoUrl!}
            videoSourceRef={message.videoSourceRef}
            messageId={message.id}
            mediaKind="vibe_clip"
            onResolvedVideoUrl={(url) => onResolvedVideoUrl?.(message.id, url)}
            duration={message.videoDuration || 0}
            isMine={isMine}
            onRequestImmersive={
              message.videoUrl
                ? () =>
                    onRequestImmersiveVideo({
                      url: videoUrlOverride ?? message.videoUrl!,
                      posterUrl: null,
                      messageId: message.id,
                      videoSourceRef: message.videoSourceRef,
                      mediaKind: "vibe_clip",
                    })
                : undefined
            }
            immersiveActive={!!message.videoUrl && immersiveVideoUrl === (videoUrlOverride ?? message.videoUrl)}
            threadVisualRecede={threadVisualRecede}
          />
        )}
        {message.isLastInGroup && (
          <div className={cn("mt-1 flex", isMine ? "justify-end" : "justify-start")}>
            <MessageStatus
              status={message.status || "delivered"}
              time={message.time}
              isMyMessage={isMine}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useUserProfile();
  const currentUserId = user?.id || "";
  const queryClient = useQueryClient();
  
  const {
    data: chatData,
    isLoading: isLoadingChat,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(id || "", currentUserId);
  const webOutbox = useWebChatOutbox();
  const { data: dateSuggestions = [], refetch: refetchDateSuggestions } = useMatchDateSuggestions(
    chatData?.matchId,
  );

  const [exiting, setExiting] = useState(false);
  const [outboxPreviews, setOutboxPreviews] = useState<OutboxPreviewMap>({});
  const [newMessage, setNewMessage] = useState("");
  const [localTyping, setLocalTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showPhotoCamera, setShowPhotoCamera] = useState(false);
  const [showVibeClipOptions, setShowVibeClipOptions] = useState(false);
  const [showScheduleShare, setShowScheduleShare] = useState(false);
  const [showActiveDateSuggestionWarning, setShowActiveDateSuggestionWarning] = useState(false);
  const [editScheduleShareSuggestionId, setEditScheduleShareSuggestionId] =
    useState<string | null>(null);
  const [focusedSuggestionId, setFocusedSuggestionId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [showAttachmentTray, setShowAttachmentTray] = useState(false);
  const [showDateComposer, setShowDateComposer] = useState(false);
  const [dateComposerLaunchSource, setDateComposerLaunchSource] =
    useState<DateComposerLaunchSource>("default");
  const [composerDraftId, setComposerDraftId] = useState<string | null>(null);
  const [composerDraftPayload, setComposerDraftPayload] = useState<Record<string, unknown> | null>(null);
  const [composerCounter, setComposerCounter] = useState<{
    suggestionId: string;
    previousRevision: DateSuggestionWithRelations["revisions"][0];
  } | null>(null);
  const [showArcade, setShowArcade] = useState(false);
  const [activeGameCreator, setActiveGameCreator] = useState<GameType | null>(null);
  const [photoLightboxInitialId, setPhotoLightboxInitialId] = useState<string | null>(null);
  const [videoLightbox, setVideoLightbox] = useState<ChatVideoLightboxState | null>(null);
  const [expandedPendingClusterKey, setExpandedPendingClusterKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const composerChromeRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const stickToBottomRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  /** True until we have applied the first bottom snap for this thread (avoids onScroll racing before scrollToBottom). */
  const pendingThreadBottomSnapRef = useRef(false);
  const lastThreadCountRef = useRef(0);
  const olderPageScrollSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelowCue, setNewBelowCue] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const gameStartLockRef = useRef(false);
  const actionLockRef = useRef<Set<string>>(new Set());
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backNavWatchdogTimeoutsRef = useRef<number[]>([]);
  const backNavWatchdogRafRef = useRef<number | null>(null);
  const stickyBottomSnapTimeoutsRef = useRef<number[]>([]);
  const stickyBottomSnapRafRef = useRef<number | null>(null);
  const stickyBottomSnapUntilRef = useRef(0);
  const mobileKeyboardViewportStyleClearTimeoutRef = useRef<number | null>(null);
  const mobileKeyboardStableViewportHeightRef = useRef<number | null>(
    typeof window === "undefined"
      ? null
      : Math.max(window.visualViewport?.height ?? 0, window.innerHeight ?? 0),
  );
  const [mobileKeyboardViewportStyle, setMobileKeyboardViewportStyle] = useState<CSSProperties | undefined>();

  const clearChatBackNavWatchdogs = useCallback(() => {
    if (typeof window === "undefined") return;
    for (const t of backNavWatchdogTimeoutsRef.current) window.clearTimeout(t);
    backNavWatchdogTimeoutsRef.current = [];
    if (backNavWatchdogRafRef.current != null) {
      window.cancelAnimationFrame(backNavWatchdogRafRef.current);
      backNavWatchdogRafRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearChatBackNavWatchdogs();
    },
    [clearChatBackNavWatchdogs],
  );

  const clearMobileKeyboardViewportStyleTimeout = useCallback(() => {
    if (typeof window !== "undefined" && mobileKeyboardViewportStyleClearTimeoutRef.current !== null) {
      window.clearTimeout(mobileKeyboardViewportStyleClearTimeoutRef.current);
    }
    mobileKeyboardViewportStyleClearTimeoutRef.current = null;
  }, []);

  const clearMobileKeyboardViewportStyle = useCallback(() => {
    clearMobileKeyboardViewportStyleTimeout();
    setMobileKeyboardViewportStyle(undefined);
  }, [clearMobileKeyboardViewportStyleTimeout]);

  const scheduleMobileKeyboardViewportStyleClear = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      setMobileKeyboardViewportStyle(undefined);
      return;
    }

    clearMobileKeyboardViewportStyleTimeout();
    mobileKeyboardViewportStyleClearTimeoutRef.current = window.setTimeout(() => {
      mobileKeyboardViewportStyleClearTimeoutRef.current = null;
      if (document.activeElement !== inputRef.current) {
        setMobileKeyboardViewportStyle(undefined);
      }
    }, CHAT_MOBILE_KEYBOARD_STYLE_CLEAR_DELAY_MS);
  }, [clearMobileKeyboardViewportStyleTimeout]);

  const updateMobileKeyboardViewportStyle = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      setMobileKeyboardViewportStyle(undefined);
      return;
    }

    const textarea = inputRef.current;
    const viewport = window.visualViewport;
    const desktopMediaQuery =
      typeof window.matchMedia === "function" ? window.matchMedia(CHAT_DESKTOP_VIEWPORT_QUERY) : null;
    const desktopViewport = desktopMediaQuery?.matches ?? window.innerWidth >= 1024;
    const currentViewportHeight = viewport?.height ?? 0;
    const currentLayoutHeight = window.innerHeight;
    if (!textarea || document.activeElement !== textarea || !viewport || desktopViewport) {
      mobileKeyboardStableViewportHeightRef.current = Math.max(currentViewportHeight, currentLayoutHeight);
      clearMobileKeyboardViewportStyle();
      return;
    }

    clearMobileKeyboardViewportStyleTimeout();
    const stableViewportHeight =
      mobileKeyboardStableViewportHeightRef.current ?? Math.max(currentViewportHeight, currentLayoutHeight);
    const keyboardOverlap = Math.max(
      currentLayoutHeight - currentViewportHeight,
      stableViewportHeight - currentViewportHeight,
    );
    if (keyboardOverlap < CHAT_MOBILE_KEYBOARD_THRESHOLD_PX) {
      mobileKeyboardStableViewportHeightRef.current = Math.max(currentViewportHeight, currentLayoutHeight);
      clearMobileKeyboardViewportStyle();
      return;
    }

    setMobileKeyboardViewportStyle({
      position: "fixed",
      top: `${Math.max(0, viewport.offsetTop)}px`,
      bottom: "auto",
      left: "0px",
      right: "0px",
      height: `${Math.max(1, viewport.height)}px`,
      width: "100vw",
    });
  }, [clearMobileKeyboardViewportStyle, clearMobileKeyboardViewportStyleTimeout]);

  useEffect(
    () => () => {
      clearMobileKeyboardViewportStyleTimeout();
    },
    [clearMobileKeyboardViewportStyleTimeout],
  );

  const matchCall = useMatchCall({
    matchId: chatData?.matchId || null,
    partnerUserId: chatData?.otherUser?.id ?? id ?? null,
    partnerName: chatData?.otherUser?.name ?? "Your match",
    partnerAvatar: (() => {
      const primaryPath = resolvePrimaryProfilePhotoPath({
        photos: chatData?.otherUser?.photos,
        avatar_url: chatData?.otherUser?.avatar_url,
      });
      return primaryPath ? avatarUrl(primaryPath) : null;
    })(),
    onCallEnded: () => {},
  });

  useRealtimeMessages({
    matchId: chatData?.matchId || null,
    threadOtherUserId: id || null,
    threadCurrentUserId: currentUserId || null,
    enabled: !!chatData?.matchId && !!id && !!currentUserId,
  });
  const dateScheduleParticipants = useMemo(
    () => [currentUserId || null, chatData?.otherUser?.id ?? id ?? null],
    [chatData?.otherUser?.id, currentUserId, id],
  );
  useRealtimeDateScheduleState({
    matchId: chatData?.matchId || null,
    currentUserId: currentUserId || null,
    participantIds: dateScheduleParticipants,
    threadOtherUserId: id || null,
    enabled: !!chatData?.matchId && !!currentUserId,
  });
  const { partnerTyping } = useTypingBroadcast(
    chatData?.matchId ?? null,
    currentUserId || null,
    localTyping,
    !!(chatData?.matchId && currentUserId),
  );
  const { data: reactionRows = [] } = useMessageReactions(chatData?.matchId);

  const partnerUserId = chatData?.otherUser?.id ?? id ?? "";

  const markWebThreadReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleMarkWebThreadRead = useCallback(() => {
    const mid = chatData?.matchId;
    if (!mid || !user?.id) return;
    if (markWebThreadReadTimeoutRef.current) clearTimeout(markWebThreadReadTimeoutRef.current);
    markWebThreadReadTimeoutRef.current = setTimeout(() => {
      markWebThreadReadTimeoutRef.current = null;
      void supabase.rpc("mark_match_messages_read", { p_match_id: mid }).then(({ error }) => {
        if (error) return;
        void queryClient.invalidateQueries({
          queryKey: threadMessagesQueryKey(id || "", currentUserId),
          exact: true,
        });
        void queryClient.invalidateQueries({ queryKey: ["unread-home"] });
        void queryClient.invalidateQueries({ queryKey: ["unread-home-info-bar"] });
      });
    }, 400);
  }, [chatData?.matchId, currentUserId, id, queryClient, user?.id]);

  useEffect(() => {
    scheduleMarkWebThreadRead();
    return () => {
      if (markWebThreadReadTimeoutRef.current) {
        clearTimeout(markWebThreadReadTimeoutRef.current);
        markWebThreadReadTimeoutRef.current = null;
      }
    };
  }, [scheduleMarkWebThreadRead]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleMarkWebThreadRead();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scheduleMarkWebThreadRead]);

  const reactionByMessageId = useMemo(() => {
    const byMsg = new Map<string, MessageReactionRow[]>();
    for (const r of reactionRows as MessageReactionRow[]) {
      const arr = byMsg.get(r.message_id) ?? [];
      arr.push(r);
      byMsg.set(r.message_id, arr);
    }
    const out = new Map<string, ReactionPair>();
    for (const [mid, rows] of byMsg) {
      out.set(mid, reactionPairFromRows(rows, currentUserId, partnerUserId));
    }
    return out;
  }, [reactionRows, currentUserId, partnerUserId]);

  const otherUser = useMemo(() => {
    if (chatData?.otherUser) {
      const ou = chatData.otherUser;

      const primaryPhotoPath = resolvePrimaryProfilePhotoPath({
        photos: ou.photos,
        avatar_url: ou.avatar_url,
      });
      const resolvedAvatar = primaryPhotoPath ? avatarUrl(primaryPhotoPath) : "/placeholder.svg";

      return {
        id: ou.id,
        name: ou.name || "Unknown",
        age: ou.age || 0,
        avatar_url: resolvedAvatar,
        photos: Array.isArray(ou.photos)
          ? ou.photos.map((p) => getImageUrl(typeof p === "string" ? p : "")).filter(Boolean) as string[]
          : [],
        vibes: [] as string[],
        isOnline: ou.is_online === true,
        photoVerified: ou.photo_verified || false,
        subscription_tier: ou.subscription_tier ?? null,
        bunnyVideoUid: ou.bunny_video_uid ?? null,
      };
    }
    return {
      id: id || "unknown",
      name: "Loading...",
      age: 0,
      avatar_url: "/placeholder.svg",
      photos: [] as string[],
      vibes: [] as string[],
      isOnline: false,
      photoVerified: false,
      subscription_tier: null,
      bunnyVideoUid: null,
    };
  }, [chatData?.otherUser, id]);

  const headerActivity = useMemo((): ChatHeaderActivityLine | null => {
    const raw = chatData?.otherUser?.last_seen_at;
    if (raw == null || String(raw).trim() === "") return null;
    const lastSeenAtMs = new Date(raw).getTime();
    if (Number.isNaN(lastSeenAtMs)) return null;
    const diffMin = (Date.now() - lastSeenAtMs) / 60000;
    if (diffMin <= 5) return { text: "Active now", variant: "online" };
    if (diffMin <= 30) return { text: "Active recently", variant: "muted" };
    if (diffMin <= 24 * 60) return { text: "Active today", variant: "muted" };
    if (diffMin <= 7 * 24 * 60) return { text: "Active this week", variant: "muted" };
    return null;
  }, [chatData?.otherUser?.last_seen_at]);

  useEffect(
    () => () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    },
    [],
  );

  const outboxMatchItems = webOutbox.itemsForMatch(chatData?.matchId ?? "");
  const outboxItemsById = useMemo(() => {
    const map = new Map<string, WebChatOutboxItem>();
    for (const item of outboxMatchItems) map.set(item.id, item);
    return map;
  }, [outboxMatchItems]);

  useEffect(() => {
    let cancelled = false;
    const collectUrls = (m: OutboxPreviewMap) => {
      const out: string[] = [];
      for (const v of Object.values(m)) {
        if (v?.image) out.push(v.image);
        if (v?.audio) out.push(v.audio);
        if (v?.video) out.push(v.video);
      }
      return out;
    };
    void (async () => {
      const next: OutboxPreviewMap = {};
      for (const it of outboxMatchItems) {
        const p = it.payload;
        if (p.kind === "image") {
          const b = await getOutboxBlob(p.blobKey);
          if (b && !cancelled) next[it.id] = { ...next[it.id], image: URL.createObjectURL(b) };
        } else if (p.kind === "voice") {
          const b = await getOutboxBlob(p.blobKey);
          if (b && !cancelled) next[it.id] = { ...next[it.id], audio: URL.createObjectURL(b) };
        } else if (p.kind === "video") {
          const b = await getOutboxBlob(p.blobKey);
          if (b && !cancelled) next[it.id] = { ...next[it.id], video: URL.createObjectURL(b) };
        }
      }
      if (cancelled) {
        collectUrls(next).forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setOutboxPreviews((prev) => {
        collectUrls(prev).forEach((u) => URL.revokeObjectURL(u));
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [outboxMatchItems]);

  useEffect(() => {
    const ids = new Set((chatData?.messages ?? []).map((m) => m.id));
    webOutbox.reconcileWithServerIds(ids);
  }, [chatData?.messages, webOutbox]);

  const messages: ChatMessage[] = useMemo(() => {
    const statusFromServer = (sender: "me" | "them", readAt?: string | null): MessageStatusType =>
      sender === "me" ? (readAt ? "read" : "delivered") : "delivered";

    const realMsgs: ChatMessage[] = (chatData?.messages || []).map((m) => {
      const pair = reactionByMessageId.get(m.id) ?? { mine: null, partner: null };
      const sortAtMs = new Date(m.createdAt).getTime();
      if (m.messageKind === "date_suggestion" || m.messageKind === "date_suggestion_event") {
        return {
          id: m.id,
          text: m.text,
          sender: m.sender,
          time: m.time,
          type: m.messageKind === "date_suggestion_event" ? "date-suggestion-event" : "date-suggestion",
          refId: m.refId,
          structuredPayload: m.structuredPayload ?? undefined,
          status: statusFromServer(m.sender, m.readAt),
          reactionPair: pair,
          sortAtMs,
        };
      }
      if (m.messageKind === "vibe_game_session") {
        return {
          id: m.id,
          text: m.text,
          sender: m.sender,
          time: m.time,
          type: "vibe-game-session" as const,
          status: statusFromServer(m.sender, m.readAt),
          gameSessionView: m.gameSessionView,
          reactionPair: pair,
          sortAtMs,
        };
      }
      return {
        id: m.id,
        text: m.text,
        sender: m.sender,
        time: m.time,
        type: inferChatMediaRenderKind({
          content: m.text,
          audioUrl: m.audioUrl,
          videoUrl: m.videoUrl,
          messageKind: m.messageKind,
        }) as ChatMessage["type"],
        audioUrl: m.audioUrl,
        audioSourceRef: m.audioSourceRef,
        audioDuration: m.audioDuration,
        imageSourceRef: m.imageSourceRef,
        videoUrl: m.videoUrl,
        videoSourceRef: m.videoSourceRef,
        videoDuration: m.videoDuration,
        thumbnailSourceRef: m.thumbnailSourceRef,
        structuredPayload: m.structuredPayload ?? undefined,
        status: statusFromServer(m.sender, m.readAt),
        reactionPair: pair,
        sortAtMs,
      };
    });
    const outboxRows = webOutboxItemsToRows(outboxMatchItems, outboxPreviews) as ChatMessage[];
    return mergeServerAndLocalChatMessages(realMsgs, outboxRows);
  }, [chatData?.messages, outboxMatchItems, outboxPreviews, reactionByMessageId]);

  const displayMessages = useMemo(() => {
    return dedupeLatestByRefId(messages, {
      isDedupeCandidate: (m) => m.type === "date-suggestion" || m.type === "date-suggestion-event",
      getRefId: (m) => m.refId,
      getId: (m) => m.id,
    });
  }, [messages]);

  const [photoUrlOverridesById, setPhotoUrlOverridesById] = useState<Record<string, string>>({});
  const photoUrlForMessage = useCallback(
    (message: ChatMessage): string | null =>
      photoUrlOverridesById[message.id] ??
      parseChatImageMessageContent(message.text, { allowLocalPreviewUrls: true }),
    [photoUrlOverridesById],
  );
  const refreshPhotoUrlForMessage = useCallback(async (message: ChatMessage): Promise<string | null> => {
    if (!message.imageSourceRef) return null;
    const freshUrl = await refreshCachedChatMediaUrl(message.id, "image", message.imageSourceRef);
    if (!freshUrl) return null;
    setPhotoUrlOverridesById((prev) => (prev[message.id] === freshUrl ? prev : { ...prev, [message.id]: freshUrl }));
    return freshUrl;
  }, []);
  const refreshPhotoLightboxItem = useCallback(async (item: { id: string; sourceRef?: string | null }) => {
    if (!item.sourceRef) return null;
    const freshUrl = await refreshCachedChatMediaUrl(item.id, "image", item.sourceRef);
    if (!freshUrl) return null;
    setPhotoUrlOverridesById((prev) => (prev[item.id] === freshUrl ? prev : { ...prev, [item.id]: freshUrl }));
    return freshUrl;
  }, []);
  const [videoUrlOverridesById, setVideoUrlOverridesById] = useState<Record<string, string>>({});
  const [thumbnailUrlOverridesById, setThumbnailUrlOverridesById] = useState<Record<string, string>>({});
  const rememberResolvedVideoUrl = useCallback((messageId: string, url: string) => {
    setVideoUrlOverridesById((prev) => (prev[messageId] === url ? prev : { ...prev, [messageId]: url }));
  }, []);
  const rememberResolvedThumbnailUrl = useCallback((messageId: string, url: string) => {
    setThumbnailUrlOverridesById((prev) => (prev[messageId] === url ? prev : { ...prev, [messageId]: url }));
  }, []);
  const videoUrlForMessage = useCallback(
    (message: ChatMessage): string | undefined => videoUrlOverridesById[message.id] ?? message.videoUrl,
    [videoUrlOverridesById],
  );

  const outboxClipStateRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const it of webOutbox.items) {
      if (it.payload.kind !== "video") continue;
      const prev = outboxClipStateRef.current.get(it.id);
      if (prev === "sending" && it.state === "awaiting_hydration") {
        trackVibeClipEvent("clip_send_succeeded", {
          duration_bucket: durationBucketFromSeconds(
            typeof it.payload.durationSeconds === "number" ? it.payload.durationSeconds : 0,
          ),
          has_poster: false,
          thread_bucket: threadBucketFromCount(chatData?.messages?.length ?? 0),
          is_sender: true,
        });
        toast.success(VIBE_CLIP_TOAST_SENT);
      }
      outboxClipStateRef.current.set(it.id, it.state);
    }
  }, [webOutbox.items, chatData?.messages?.length]);

  const chatPhotoLightboxItems = useMemo(() => {
    const out: { id: string; url: string; sourceRef?: string | null }[] = [];
    for (const m of displayMessages) {
      if (m.type !== "image") continue;
      const url = photoUrlForMessage(m);
      if (!url) continue;
      out.push({ id: m.id, url, sourceRef: m.imageSourceRef });
    }
    return out;
  }, [displayMessages, photoUrlForMessage]);

  useEffect(() => {
    if (!showDateComposer || dateComposerLaunchSource !== "vibe_clip") return;
    trackVibeClipEvent("clip_date_flow_opened", {
      launched_from: "clip_context",
      thread_bucket: threadBucketFromCount(chatData?.messages?.length ?? 0),
    });
  }, [showDateComposer, dateComposerLaunchSource, chatData?.messages?.length]);

  const hydratedDateSuggestions = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of chatData?.dateSuggestions ?? []) {
      map.set(s.id, s);
    }
    for (const s of dateSuggestions) {
      map.set(s.id, s);
    }
    return Array.from(map.values());
  }, [chatData?.dateSuggestions, dateSuggestions]);

  const suggestionById = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of hydratedDateSuggestions) {
      map.set(s.id, s);
    }
    return map;
  }, [hydratedDateSuggestions]);

  const handleGameSelect = (gameType: GameType) => {
    setShowArcade(false);
    setActiveGameCreator(gameType);
  };

  const submitGameStart = useCallback(
    async (payload: GamePayload) => {
      if (!chatData?.matchId) {
        toast.error("No active conversation found");
        return;
      }
      if (gameStartLockRef.current) return;
      gameStartLockRef.current = true;
      setActiveGameCreator(null);
      const gameSessionId = newVibeGameSessionId();

      let input:
        | {
            event_type: "session_start";
            game_type: GamePayload["gameType"];
            payload: Record<string, unknown>;
          }
        | null = null;

      if (payload.gameType === "2truths") {
        const statements = payload.data.statements.slice(0, 3) as [string, string, string];
        input = {
          event_type: "session_start",
          game_type: "2truths",
          payload: { statements, lie_index: payload.data.lieIndex as 0 | 1 | 2 },
        };
      } else if (payload.gameType === "would_rather") {
        input = {
          event_type: "session_start",
          game_type: "would_rather",
          payload: {
            option_a: payload.data.optionA,
            option_b: payload.data.optionB,
            sender_vote: payload.data.senderVote,
          },
        };
      } else if (payload.gameType === "charades") {
        input = {
          event_type: "session_start",
          game_type: "charades",
          payload: { answer: payload.data.answer, emojis: payload.data.emojis },
        };
      } else if (payload.gameType === "scavenger") {
        input = {
          event_type: "session_start",
          game_type: "scavenger",
          payload: {
            prompt: payload.data.prompt,
            sender_photo_url: payload.data.senderPhotoUrl,
          },
        };
      } else if (payload.gameType === "roulette") {
        input = {
          event_type: "session_start",
          game_type: "roulette",
          payload: {
            question: payload.data.question,
            sender_answer: payload.data.senderAnswer,
          },
        };
      } else if (payload.gameType === "intuition") {
        input = {
          event_type: "session_start",
          game_type: "intuition",
          payload: {
            options: payload.data.options as [string, string],
            sender_choice: payload.data.senderChoice,
          },
        };
      }

      if (!input) {
        gameStartLockRef.current = false;
        toast.error("Unsupported game payload");
        return;
      }

      try {
        const result = await sendGameEvent({
          match_id: chatData.matchId,
          game_session_id: gameSessionId,
          event_index: 0,
          event_type: input.event_type,
          game_type: input.game_type,
          payload: input.payload,
        });
        if (result.ok === false) {
          toast.error(formatSendGameEventError(result.error));
          return;
        }
        queryClient.invalidateQueries({
          queryKey: threadMessagesQueryKey(id || "", currentUserId),
          exact: true,
        });
        queryClient.invalidateQueries({ queryKey: ["matches"] });
        queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
        toast.success("Game sent!");
      } finally {
        gameStartLockRef.current = false;
      }
    },
    [chatData?.matchId, currentUserId, id, queryClient]
  );

  const submitPersistedGameAction = useCallback(
    async (
      view: WebHydratedGameSessionView,
      payload: GamePayload,
      updates: Partial<GamePayload["data"]>
    ) => {
      if (!chatData?.matchId || !currentUserId) return;
      if (!view.starterUserId || view.starterUserId === currentUserId) return;
      if (view.status !== "active") return;
      if (actionLockRef.current.has(view.gameSessionId)) return;

      let event_type:
        | "two_truths_guess"
        | "would_rather_vote"
        | "charades_guess"
        | "scavenger_photo"
        | "roulette_answer"
        | "intuition_result"
        | null = null;
      let eventPayload: Record<string, unknown> | null = null;

      if (
        payload.gameType === "2truths" &&
        "guessedIndex" in updates &&
        typeof updates.guessedIndex === "number"
      ) {
        event_type = "two_truths_guess";
        eventPayload = { guess_index: updates.guessedIndex };
      } else if (
        payload.gameType === "would_rather" &&
        "receiverVote" in updates &&
        (updates.receiverVote === "A" || updates.receiverVote === "B")
      ) {
        event_type = "would_rather_vote";
        eventPayload = { receiver_vote: updates.receiverVote };
      } else if (
        payload.gameType === "charades" &&
        "guesses" in updates &&
        Array.isArray(updates.guesses) &&
        updates.guesses.length > 0
      ) {
        const guess = updates.guesses[updates.guesses.length - 1];
        if (typeof guess === "string" && guess.trim()) {
          event_type = "charades_guess";
          eventPayload = { guess };
        }
      } else if (
        payload.gameType === "scavenger" &&
        "receiverPhotoUrl" in updates &&
        typeof updates.receiverPhotoUrl === "string"
      ) {
        event_type = "scavenger_photo";
        eventPayload = { receiver_photo_url: updates.receiverPhotoUrl };
      } else if (
        payload.gameType === "roulette" &&
        "receiverAnswer" in updates &&
        typeof updates.receiverAnswer === "string"
      ) {
        event_type = "roulette_answer";
        eventPayload = { receiver_answer: updates.receiverAnswer };
      } else if (
        payload.gameType === "intuition" &&
        "receiverResponse" in updates &&
        (updates.receiverResponse === "correct" || updates.receiverResponse === "wrong")
      ) {
        event_type = "intuition_result";
        eventPayload = { result: updates.receiverResponse };
      }

      if (!event_type || !eventPayload) return;

      actionLockRef.current.add(view.gameSessionId);
      try {
        const result = await sendGameEvent({
          match_id: chatData.matchId,
          game_session_id: view.gameSessionId,
          event_index: view.latestEventIndex + 1,
          event_type,
          game_type: payload.gameType,
          payload: eventPayload,
        });

        if (result.ok === false) {
          toast.error(formatSendGameEventError(result.error));
          return;
        }

        queryClient.invalidateQueries({
          queryKey: threadMessagesQueryKey(id || "", currentUserId),
          exact: true,
        });
        queryClient.invalidateQueries({ queryKey: ["matches"] });
        queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
      } finally {
        actionLockRef.current.delete(view.gameSessionId);
      }
    },
    [chatData?.matchId, currentUserId, id, queryClient]
  );

  const isUserScrollIntentActive = useCallback(() => {
    return Date.now() < userScrollIntentUntilRef.current;
  }, []);

  const suspendAutoStickForUserScroll = useCallback(() => {
    stickyBottomSnapUntilRef.current = 0;
    userScrollIntentUntilRef.current = Date.now() + 900;
    stickToBottomRef.current = false;
  }, []);

  const updateBottomState = useCallback((distanceFromBottom: number) => {
    const atBottom = distanceFromBottom < 120;
    const stickySnapArmed = Date.now() < stickyBottomSnapUntilRef.current && !isUserScrollIntentActive();
    if (!atBottom && stickySnapArmed) {
      stickToBottomRef.current = true;
      setAwayFromBottom(false);
      return;
    }
    stickToBottomRef.current = atBottom;
    setAwayFromBottom(distanceFromBottom > 140);
    if (atBottom) setNewBelowCue(false);
  }, [isUserScrollIntentActive]);

  const scrollToBottom = useCallback((opts?: { instant?: boolean }) => {
    const el = mainScrollRef.current;
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    setNewBelowCue(false);
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: opts?.instant ? "auto" : "smooth",
      });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: opts?.instant ? "auto" : "smooth" });
  }, []);

  const clearScheduledStickyBottomSnaps = useCallback(() => {
    if (typeof window === "undefined") return;
    for (const t of stickyBottomSnapTimeoutsRef.current) window.clearTimeout(t);
    stickyBottomSnapTimeoutsRef.current = [];
    stickyBottomSnapUntilRef.current = 0;
    if (stickyBottomSnapRafRef.current != null) {
      window.cancelAnimationFrame(stickyBottomSnapRafRef.current);
      stickyBottomSnapRafRef.current = null;
    }
  }, []);

  const scheduleStickyBottomSnap = useCallback((opts?: { instant?: boolean }) => {
    if (typeof window === "undefined") return;
    if (!stickToBottomRef.current) return;
    if (isUserScrollIntentActive()) return;
    clearScheduledStickyBottomSnaps();
    stickyBottomSnapUntilRef.current = Date.now() + 650;

    const snap = () => {
      const stickySnapArmed = Date.now() < stickyBottomSnapUntilRef.current;
      if (!stickToBottomRef.current && !stickySnapArmed) return;
      if (isUserScrollIntentActive()) return;
      stickToBottomRef.current = true;
      scrollToBottom({ instant: opts?.instant ?? true });
    };

    stickyBottomSnapRafRef.current = window.requestAnimationFrame(() => {
      stickyBottomSnapRafRef.current = null;
      snap();
    });
    stickyBottomSnapTimeoutsRef.current.push(
      window.setTimeout(snap, 80),
      window.setTimeout(snap, 180),
      window.setTimeout(snap, 320),
    );
  }, [clearScheduledStickyBottomSnaps, isUserScrollIntentActive, scrollToBottom]);

  useEffect(() => () => clearScheduledStickyBottomSnaps(), [clearScheduledStickyBottomSnaps]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const handleMobileViewportChange = () => {
      updateMobileKeyboardViewportStyle();
      scheduleStickyBottomSnap({ instant: true });
    };

    handleMobileViewportChange();

    if (viewport) {
      viewport.addEventListener("resize", handleMobileViewportChange);
      viewport.addEventListener("scroll", handleMobileViewportChange);
    }
    window.addEventListener("resize", handleMobileViewportChange);
    window.addEventListener("orientationchange", handleMobileViewportChange);

    return () => {
      if (viewport) {
        viewport.removeEventListener("resize", handleMobileViewportChange);
        viewport.removeEventListener("scroll", handleMobileViewportChange);
      }
      window.removeEventListener("resize", handleMobileViewportChange);
      window.removeEventListener("orientationchange", handleMobileViewportChange);
    };
  }, [scheduleStickyBottomSnap, updateMobileKeyboardViewportStyle]);

  const handleComposerFocus = useCallback(() => {
    clearMobileKeyboardViewportStyleTimeout();
    if (typeof window !== "undefined") {
      mobileKeyboardStableViewportHeightRef.current = Math.max(
        window.visualViewport?.height ?? 0,
        window.innerHeight ?? 0,
      );
    }
    updateMobileKeyboardViewportStyle();
    scheduleStickyBottomSnap({ instant: false });
  }, [clearMobileKeyboardViewportStyleTimeout, scheduleStickyBottomSnap, updateMobileKeyboardViewportStyle]);

  const handleComposerBlur = useCallback(() => {
    scheduleMobileKeyboardViewportStyleClear();
    scheduleStickyBottomSnap({ instant: true });
  }, [scheduleMobileKeyboardViewportStyleClear, scheduleStickyBottomSnap]);

  const onMainScroll = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    updateBottomState(distanceFromBottom);
    if (scrollTop < 96 && hasNextPage && !isFetchingNextPage) {
      olderPageScrollSnapshotRef.current = { scrollHeight, scrollTop };
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, updateBottomState]);

  const onMainWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (Math.abs(event.deltaY) < 1) return;
      if (event.deltaY < 0) {
        suspendAutoStickForUserScroll();
        return;
      }
      const el = mainScrollRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom > 24) suspendAutoStickForUserScroll();
    },
    [suspendAutoStickForUserScroll],
  );

  const onMainTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onMainTouchMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      const nextY = event.touches[0]?.clientY ?? null;
      const prevY = lastTouchYRef.current;
      lastTouchYRef.current = nextY;
      if (nextY == null || prevY == null) return;
      if (Math.abs(nextY - prevY) < 3) return;
      const el = mainScrollRef.current;
      const distanceFromBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
      if (nextY > prevY || distanceFromBottom > 24) {
        suspendAutoStickForUserScroll();
      }
    },
    [suspendAutoStickForUserScroll],
  );

  const onMainTouchEnd = useCallback(() => {
    lastTouchYRef.current = null;
  }, []);

  useEffect(() => {
    const lowerMessage = newMessage.toLowerCase();
    const hasKeyword = DATE_SUGGESTION_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
    setShowDateSuggestion(hasKeyword && newMessage.length > 3);
  }, [newMessage]);

  const threadAnchorLabel = useMemo(() => {
    const first = chatData?.messages?.[0];
    if (!first?.createdAt) return null;
    try {
      return `Chat since ${format(new Date(first.createdAt), "MMM yyyy")}`;
    } catch {
      return null;
    }
  }, [chatData?.messages]);

  const lastClipOrVideoIndex = useMemo(() => {
    let last = -1;
    displayMessages.forEach((m, i) => {
      if (m.type === "vibe_clip" || m.type === "video") last = i;
    });
    return last;
  }, [displayMessages]);

  const threadRows = useMemo(
    () =>
      buildThreadPresentationRows(displayMessages, {
        isDateTimeline: (m) =>
          m.type === "date-suggestion" || m.type === "date-suggestion-event",
        getRefId: (m) => m.refId ?? null,
        suggestionStatus: (refId) => suggestionById.get(refId)?.status,
        isPendingGame: (m) =>
          m.type === "vibe-game-session" && m.gameSessionView?.status === "active",
        expandedPendingKey: expandedPendingClusterKey,
      }),
    [displayMessages, suggestionById, expandedPendingClusterKey],
  );

  const rowsWithLayout = useMemo(() => {
    return threadRows.map((row, index) => {
      if (row.type === "pending_games_summary" || row.type === "pending_games_collapse") {
        return { row, isFirstInGroup: true, isLastInGroup: true, showAvatar: false };
      }
      const prev = index > 0 ? threadRows[index - 1] : null;
      const next = index < threadRows.length - 1 ? threadRows[index + 1] : null;
      const prevS =
        prev?.type === "message"
          ? prev.message.sender
          : prev?.type === "pending_games_summary"
            ? prev.primary.sender
            : null;
      const nextS =
        next?.type === "message"
          ? next.message.sender
          : next?.type === "pending_games_summary"
            ? next.primary.sender
            : null;
      const m = row.message;
      const isFirstInGroup = prevS === null || prevS !== m.sender;
      const isLastInGroup = nextS === null || nextS !== m.sender;
      const showAvatar = isLastInGroup && m.sender === "them";
      return { row, isFirstInGroup, isLastInGroup, showAvatar };
    });
  }, [threadRows]);

  useLayoutEffect(() => {
    lastThreadCountRef.current = 0;
    setNewBelowCue(false);
    setAwayFromBottom(false);
    stickToBottomRef.current = true;
    userScrollIntentUntilRef.current = 0;
    pendingThreadBottomSnapRef.current = true;
  }, [id]);

  useLayoutEffect(() => {
    if (isLoadingChat) return;
    if (displayMessages.length === 0) {
      pendingThreadBottomSnapRef.current = false;
      return;
    }
    if (!pendingThreadBottomSnapRef.current) return;
    pendingThreadBottomSnapRef.current = false;
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    setNewBelowCue(false);
    scrollToBottom({ instant: true });
  }, [id, isLoadingChat, displayMessages.length, rowsWithLayout, scrollToBottom]);

  useLayoutEffect(() => {
    if (isFetchingNextPage) return;
    const snapshot = olderPageScrollSnapshotRef.current;
    const el = mainScrollRef.current;
    if (!snapshot || !el) return;
    olderPageScrollSnapshotRef.current = null;
    userScrollIntentUntilRef.current = Date.now() + 900;
    el.scrollTop = el.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
  }, [isFetchingNextPage, rowsWithLayout]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (isUserScrollIntentActive()) return;
    scheduleStickyBottomSnap();
  }, [rowsWithLayout, isUserScrollIntentActive, scheduleStickyBottomSnap]);

  useEffect(() => {
    const n = displayMessages.length;
    const prev = lastThreadCountRef.current;
    if (n > prev && prev > 0 && awayFromBottom) {
      setNewBelowCue(true);
    }
    lastThreadCountRef.current = n;
  }, [displayMessages.length, awayFromBottom]);

  useEffect(() => {
    const node = threadContentRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      if (isUserScrollIntentActive()) return;
      scheduleStickyBottomSnap({ instant: true });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [id, isLoadingChat, displayMessages.length, isUserScrollIntentActive, scheduleStickyBottomSnap]);

  useEffect(() => {
    const node = composerChromeRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      scheduleStickyBottomSnap({ instant: true });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [scheduleStickyBottomSnap]);

  useEffect(() => {
    setExpandedPendingClusterKey(null);
  }, [id]);

  const threadInvalidateScope = useMemo(
    () =>
      id && currentUserId
        ? { otherUserId: id, currentUserId, matchId: chatData?.matchId ?? null }
        : undefined,
    [id, currentUserId, chatData?.matchId],
  );

  const sendTextMessage = useCallback(
    (opts?: { text?: string }) => {
      const text = (opts?.text ?? newMessage).trim();
      if (!text) return;
      if (!chatData?.matchId || !id) {
        toast.error("No active conversation found");
        return;
      }
      if (!threadInvalidateScope) {
        toast.error("No active conversation found");
        return;
      }
      const oid = webOutbox.enqueue({
        matchId: chatData.matchId,
        otherUserId: id,
        userId: currentUserId,
        payload: { kind: "text", text },
        invalidateScope: threadInvalidateScope,
      });
      if (oid && typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(8);
      }
    },
    [chatData?.matchId, currentUserId, id, newMessage, threadInvalidateScope, webOutbox],
  );

  const queuePhotoFile = useCallback(
    async (file: File): Promise<boolean> => {
      const imageMimeType = imageMimeTypeForUpload(file.type, file.name);
      if (!imageMimeType) {
        toast.error("Please choose an image file");
        return false;
      }
      if (!chatData?.matchId || !user?.id || !id) {
        toast.error("Cannot send photo right now");
        return false;
      }
      if (!threadInvalidateScope) {
        toast.error("Cannot send photo right now");
        return false;
      }
      setSendingPhoto(true);
      try {
        const blobKey = crypto.randomUUID();
        await putOutboxBlob(blobKey, file);
        webOutbox.enqueue({
          matchId: chatData.matchId,
          otherUserId: id,
          userId: currentUserId,
          payload: { kind: "image", blobKey, mimeType: imageMimeType, fileName: file.name || undefined },
          invalidateScope: threadInvalidateScope,
        });
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(8);
        }
        return true;
      } catch (err) {
        console.error("Photo queue error:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't add photo to send queue");
        return false;
      } finally {
        setSendingPhoto(false);
      }
    },
    [chatData?.matchId, currentUserId, id, threadInvalidateScope, user?.id, webOutbox],
  );

  const handlePhotoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await queuePhotoFile(file);
    },
    [queuePhotoFile],
  );

  const handleSend = () => {
    if (!newMessage.trim()) return;
    recordUserAction("chat_text_send_clicked", {
      surface: "chat_thread",
      match_id: chatData?.matchId ?? id,
      draft_length_bucket: newMessage.trim().length > 120 ? "long" : newMessage.trim().length > 40 ? "medium" : "short",
    });
    stickToBottomRef.current = true;
    setNewMessage("");
    setLocalTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setShowDateSuggestion(false);
    sendTextMessage();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  };

  const handleComposerChange = (text: string) => {
    setNewMessage(text);
    const hasDraft = !!text.trim();
    setLocalTyping(hasDraft);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (hasDraft) {
      typingTimeoutRef.current = setTimeout(() => setLocalTyping(false), 3000);
    }
  };

  // Declared early so handleOpenDateComposerFromChip + handleOpenDateComposer
  // can reference it without TS2448 (use-before-declaration under
  // tsconfig.core-strict.json's noFunctionDeclarationsBeforeUse-style check).
  const focusExistingSuggestion = useCallback((suggestionId: string | null) => {
    if (!suggestionId) return;
    setFocusedSuggestionId(suggestionId);
    setFocusToken((t) => t + 1);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-suggestion-id="${suggestionId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, []);

  const warnAboutActiveSuggestion = useCallback(
    (suggestionId: string | null) => {
      focusExistingSuggestion(suggestionId);
      setShowActiveDateSuggestionWarning(true);
    },
    [focusExistingSuggestion],
  );

  const handleActiveDateSuggestionWarningOpenChange = useCallback(
    (nextOpen: boolean) => {
      setShowActiveDateSuggestionWarning(nextOpen);
      if (!nextOpen) focusExistingSuggestion(focusedSuggestionId);
    },
    [focusExistingSuggestion, focusedSuggestionId],
  );

  const handleOpenDateComposerFromChip = () => {
    if (!chatData?.matchId || !id) {
      toast.error("No active conversation found");
      return;
    }
    recordUserAction("chat_date_suggestion_open_clicked", {
      surface: "chat_thread",
      match_id: chatData?.matchId ?? id,
      source: "chip",
    });
    const existing = findBlockingDateSuggestion(hydratedDateSuggestions);
    if (existing) {
      warnAboutActiveSuggestion(existing.id);
      return;
    }
    setComposerCounter(null);
    setComposerDraftId(null);
    setComposerDraftPayload(null);
    setShowDateComposer(true);
    setNewMessage("");
    setLocalTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setShowDateSuggestion(false);
  };

  const handleOpenDateComposer = useCallback(
    (opts: {
      mode: "new" | "counter" | "editDraft";
      draftId?: string;
      draftPayload?: Record<string, unknown> | null;
      counter?: {
        suggestionId: string;
        previousRevision: DateSuggestionWithRelations["revisions"][0];
      };
      launchFrom?: DateComposerLaunchSource;
    }) => {
      if (opts.mode === "counter" && opts.counter) {
        setDateComposerLaunchSource("default");
        setComposerCounter({
          suggestionId: opts.counter.suggestionId,
          previousRevision: opts.counter.previousRevision,
        });
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      } else if (opts.mode === "editDraft" && opts.draftId) {
        setDateComposerLaunchSource("default");
        setComposerDraftId(opts.draftId);
        setComposerDraftPayload(opts.draftPayload ?? null);
        setComposerCounter(null);
      } else {
        const existing = findBlockingDateSuggestion(hydratedDateSuggestions);
        if (existing) {
          warnAboutActiveSuggestion(existing.id);
          return;
        }
        setComposerCounter(null);
        setComposerDraftId(null);
        setComposerDraftPayload(null);
        setDateComposerLaunchSource(opts.launchFrom ?? "default");
      }
      setShowDateComposer(true);
    },
    [hydratedDateSuggestions, warnAboutActiveSuggestion],
  );

  const closeDateComposer = useCallback(() => {
    setShowDateComposer(false);
    setComposerCounter(null);
    setComposerDraftId(null);
    setComposerDraftPayload(null);
    setDateComposerLaunchSource("default");
  }, []);

  const onDateSuggestionUpdated = useCallback(() => {
    void refetchDateSuggestions();
    if (id && currentUserId) {
      queryClient.invalidateQueries({
        queryKey: threadMessagesQueryKey(id, currentUserId),
        exact: true,
      });
    }
    // Schedule-share Accept locks blocks on both calendars; cancel_plan reverts.
    // Invalidate the schedule caches so /schedule, the YOU mini-grid, and the
    // shared-schedule chips on the card all see the new state without a manual
    // refresh. Cheap for other actions (Decline/Counter/etc.) since the queries
    // are not actively read in those code paths.
    queryClient.invalidateQueries({ queryKey: ["user-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["shared-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["schedule-hub", currentUserId] });
  }, [refetchDateSuggestions, queryClient, id, currentUserId]);

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    setIsRecording(false);
    setShowAttachmentTray(false);

    if (!chatData?.matchId || !user?.id || !id) {
      toast.error("Cannot send voice message right now");
      return;
    }
    if (!threadInvalidateScope) {
      toast.error("Cannot send voice message right now");
      return;
    }

    try {
      const blobKey = crypto.randomUUID();
      await putOutboxBlob(blobKey, audioBlob);
      webOutbox.enqueue({
        matchId: chatData.matchId,
        otherUserId: id,
        userId: currentUserId,
        payload: { kind: "voice", blobKey, durationSeconds: Math.max(1, duration) },
        invalidateScope: threadInvalidateScope,
      });
    } catch (err) {
      console.error("Voice message queue error:", err);
      toast.error("Failed to queue voice message");
    }
  };

  const handleVoiceRecordingStart = useCallback(() => {
    setIsRecording(true);
  }, []);

  const handleVoiceRecordingCancel = useCallback(() => {
    setIsRecording(false);
    setShowAttachmentTray(false);
  }, []);

  const handleVideoRecordingComplete = async (
    videoBlob: Blob,
    duration: number,
    meta?: { captureSource?: CaptureSource; mimeType?: string; aspectRatio?: number | null; fileName?: string },
  ) => {
    setIsRecordingVideo(false);

    if (!chatData?.matchId || !user?.id || !id) {
      toast.error("Cannot send Vibe Clip right now");
      return;
    }

    const measuredDurationSeconds = Number.isFinite(duration) ? duration : 0.5;
    if (measuredDurationSeconds > VIBE_CLIP_MAX_DURATION_SEC + 0.25) {
      toast.error(VIBE_CLIP_UPLOAD_TOO_LONG());
      return;
    }
    const durationSeconds = Math.min(
      VIBE_CLIP_MAX_DURATION_SEC,
      Math.max(0.5, measuredDurationSeconds),
    );
    const captureSource = meta?.captureSource ?? "web_recorder";
    const durationBucket = durationBucketFromSeconds(durationSeconds);
    const threadBucket = threadBucketFromCount(displayMessages.length);

    if (!threadInvalidateScope) {
      toast.error("Cannot send Vibe Clip right now");
      return;
    }

    try {
      trackVibeClipEvent("clip_send_attempted", {
        capture_source: captureSource,
        duration_bucket: durationBucket,
        has_poster: false,
        thread_bucket: threadBucket,
        is_sender: true,
      });
      if (videoBlob.size > VIBE_CLIP_MAX_SOURCE_BYTES) {
        toast.error(VIBE_CLIP_UPLOAD_TOO_LARGE());
        return;
      }
      if (videoBlob.size > VIBE_CLIP_SOFT_SOURCE_BYTES) {
        toast(VIBE_CLIP_UPLOAD_LARGE_SOFT_WARNING);
      }

      const storedVideoName =
        meta?.fileName ||
        (typeof File !== "undefined" && videoBlob instanceof File ? videoBlob.name : undefined);
      const videoMimeType =
        videoMimeTypeForUpload(meta?.mimeType || videoBlob.type, storedVideoName) ?? GENERIC_UPLOAD_MIME_TYPE;
      if (videoMimeType === GENERIC_UPLOAD_MIME_TYPE) {
        toast.error(VIBE_CLIP_UPLOAD_INVALID_TYPE);
        return;
      }
      const blobKey = crypto.randomUUID();
      await putOutboxBlob(blobKey, videoBlob);
      webOutbox.enqueue({
        matchId: chatData.matchId,
        otherUserId: id,
        userId: currentUserId,
        payload: {
          kind: "video",
          blobKey,
          durationSeconds,
          mimeType: videoMimeType,
          fileName: storedVideoName,
          aspectRatio: meta?.aspectRatio ?? null,
        },
        invalidateScope: threadInvalidateScope,
      });
    } catch (err) {
      console.error("Vibe Clip queue error:", err);
      Sentry.captureException(err, { tags: { funnel: "vibe_clip_queue" } });
      trackVibeClipEvent("clip_send_failed", {
        failure_class: classifySendFailureMessage(err instanceof Error ? err.message : "queue"),
      });
      toast.error(VIBE_CLIP_TOAST_UPLOAD_FAIL);
    }
  };

  const handleVibeClipLibraryReady = async (
    videoBlob: Blob,
    duration: number,
    meta?: { captureSource?: CaptureSource; mimeType?: string; aspectRatio?: number | null; fileName?: string },
  ) => {
    await handleVideoRecordingComplete(videoBlob, duration, meta);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReaction = useCallback(
    async (messageId: string, emoji: ReactionEmoji | null) => {
      if (!chatData?.matchId) return;
      try {
        await setMessageReaction({ matchId: chatData.matchId, messageId, emoji });
        await queryClient.invalidateQueries({ queryKey: ["message-reactions", chatData.matchId] });
      } catch {
        toast.error("Could not update reaction");
      }
    },
    [chatData?.matchId, queryClient],
  );

  const hasText = newMessage.trim().length > 0;
  const hasActiveConversation = Boolean(chatData?.matchId && id && currentUserId);
  const composerMediaLocked = sendingPhoto || isRecordingVideo || isRecording;
  const quickActionButtonClass =
    "inline-flex h-11 min-h-11 w-full items-center justify-start gap-2 rounded-xl border border-border/35 bg-secondary/35 px-3 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:pointer-events-none disabled:opacity-45";

  const guardActiveConversation = useCallback((message = "No active conversation found") => {
    if (hasActiveConversation) return true;
    toast.error(message);
    return false;
  }, [hasActiveConversation]);

  const openArcade = useCallback(() => {
    if (!guardActiveConversation()) return;
    setShowArcade(true);
  }, [guardActiveConversation]);

  const openScheduleShare = useCallback(() => {
    if (!guardActiveConversation()) return;
    const existing = findBlockingDateSuggestion(hydratedDateSuggestions);
    if (existing) {
      warnAboutActiveSuggestion(existing.id);
      return;
    }
    setShowScheduleShare(true);
    setShowAttachmentTray(false);
  }, [guardActiveConversation, hydratedDateSuggestions, warnAboutActiveSuggestion]);

  const startMatchCall = useCallback(
    (type: "voice" | "video") => {
      if (!chatData?.matchId) {
        toast.error("No active match for calling");
        return;
      }
      void matchCall.startCall(type);
    },
    [chatData?.matchId, matchCall],
  );

  const openShareScheduleAsCounter = useCallback(
    (suggestionId: string, previousRevision: DateSuggestionWithRelations["revisions"][0]) => {
      // Counter response with own selected schedule blocks: routes through the
      // existing composer in counter mode with share preselected. Composer's
      // When step renders the ScheduleSharePicker inline.
      setDateComposerLaunchSource("default");
      setComposerCounter({ suggestionId, previousRevision });
      setComposerDraftId(null);
      setComposerDraftPayload(null);
      setShowDateComposer(true);
    },
    [],
  );

  // Sender-side entry point: open the same ScheduleSharePicker preloaded with
  // the sender's current selected blocks. Persists as `edit_schedule_share_slots`
  // on the SAME active suggestion — never creates a new card.
  const openEditScheduleShareSlots = useCallback((suggestionId: string) => {
    setEditScheduleShareSuggestionId(suggestionId);
  }, []);

  const triggerPhotoFilePicker = useCallback(() => {
    photoInputRef.current?.click();
  }, []);

  const openPhotoCamera = useCallback(() => {
    if (composerMediaLocked) return;
    if (!guardActiveConversation("Cannot send photo right now")) return;
    if (!navigator.onLine) {
      toast.error("You're offline — try again when connected");
      return;
    }
    setShowAttachmentTray(false);
    setShowPhotoCamera(true);
  }, [composerMediaLocked, guardActiveConversation]);

  const openPhotoPicker = useCallback(() => {
    if (composerMediaLocked) return;
    if (!guardActiveConversation("Cannot send photo right now")) return;
    if (!navigator.onLine) {
      toast.error("You're offline — try again when connected");
      return;
    }
    recordUserAction("chat_photo_add_clicked", {
      surface: "chat_thread",
      match_id: chatData?.matchId,
    });
    setShowAttachmentTray(false);
    setShowPhotoOptions(true);
  }, [chatData?.matchId, composerMediaLocked, guardActiveConversation]);

  const openVibeClipOptions = useCallback(() => {
    if (composerMediaLocked) return;
    if (!guardActiveConversation("Cannot record a Vibe Clip right now")) return;
    recordUserAction("chat_vibe_clip_record_clicked", {
      surface: "chat_thread",
      match_id: chatData?.matchId ?? id,
    });
    trackVibeClipEvent("clip_entry_opened", {
      thread_bucket: threadBucketFromCount(displayMessages.length),
      is_sender: true,
      launched_from: "chat",
    });
    setShowAttachmentTray(false);
    setShowVibeClipOptions(true);
  }, [chatData?.matchId, composerMediaLocked, displayMessages.length, guardActiveConversation, id]);

  const startVibeClipRecorder = useCallback(() => {
    if (composerMediaLocked) return;
    if (!guardActiveConversation("Cannot record a Vibe Clip right now")) return;
    setIsRecordingVideo(true);
  }, [composerMediaLocked, guardActiveConversation]);

  /** Chat header back: render-null instantly so the panel disappears, navigate, and hard-reload as the unconditional escape hatch if Chat is still mounted at 250ms. */
  const returnToMatches = useCallback(() => {
    clearChatBackNavWatchdogs();
    inputRef.current?.blur();
    clearMobileKeyboardViewportStyle();
    setExiting(true);

    flushSync(() => {
      navigate(MATCHES_ROUTE, { replace: true });
    });

    if (typeof window === "undefined") return;

    backNavWatchdogTimeoutsRef.current.push(
      window.setTimeout(() => {
        window.location.replace(MATCHES_ROUTE);
      }, 250),
    );
  }, [navigate, clearChatBackNavWatchdogs, clearMobileKeyboardViewportStyle]);

  if (exiting) return null;

  return (
    <div
      className="fixed inset-0 h-[100dvh] w-screen bg-[#050508] flex justify-center overflow-hidden lg:relative lg:inset-auto lg:w-auto lg:px-4 lg:py-3"
      style={mobileKeyboardViewportStyle}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,hsl(var(--primary)/0.11),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_32%)] pointer-events-none" />
      <section className="relative z-10 flex h-full w-full max-w-6xl overflow-hidden bg-background/96 shadow-2xl shadow-black/35 ring-1 ring-border/45 lg:rounded-[1.75rem]">
        <div className="min-w-0 flex flex-1 flex-col">

      <ChatHeader
        user={otherUser}
        partnerTyping={partnerTyping}
        headerActivity={headerActivity}
        threadAnchorLabel={threadAnchorLabel}
        matchId={chatData?.matchId || undefined}
        onBack={returnToMatches}
        onVideoCall={startMatchCall}
        onFocusInput={() => inputRef.current?.focus()}
      />

      <div className="flex-1 flex flex-col min-h-0 relative z-10">
      <main
        ref={(el) => {
          mainScrollRef.current = el;
        }}
        onScroll={onMainScroll}
        onWheel={onMainWheel}
        onTouchStart={onMainTouchStart}
        onTouchMove={onMainTouchMove}
        onTouchEnd={onMainTouchEnd}
        onTouchCancel={onMainTouchEnd}
        className="flex-1 overflow-y-auto overscroll-contain px-2 sm:px-3 pt-1.5 pb-5 space-y-0 min-h-0"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        aria-label="Conversation messages"
      >
        {isLoadingChat ? (
          <div className="min-h-[min(100%,28rem)] flex flex-col">
            <ChatThreadSkeleton className="flex-1" />
          </div>
        ) : displayMessages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full text-center py-12"
          >
            {otherUser.avatar_url && (
              <img
                src={otherUser.avatar_url || ''}
                alt={otherUser.name}
                className="w-16 h-16 rounded-full object-cover mb-3 border-2 border-primary/30"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div className="w-16 h-16 rounded-3xl bg-gradient-primary flex items-center justify-center mb-4">
              <span className="text-3xl">👋</span>
            </div>
            <h3 className="text-lg font-display font-semibold text-foreground mb-2">
              You and {otherUser.name} matched!
            </h3>
            <p className="text-muted-foreground text-sm max-w-xs mb-4">
              You both vibed! Say hi before the momentum fades 💬
            </p>
            <button
              type="button"
              onClick={() => {
                if (!chatData?.matchId || !threadInvalidateScope || !id) return;
                webOutbox.enqueue({
                  matchId: chatData.matchId,
                  otherUserId: id,
                  userId: currentUserId,
                  payload: { kind: "text", text: "👋" },
                  invalidateScope: threadInvalidateScope,
                });
              }}
              disabled={!hasActiveConversation}
              aria-label={`Send a wave to ${otherUser.name}`}
              title="Send a wave"
              className="px-6 py-2.5 rounded-full bg-gradient-primary text-primary-foreground font-medium text-sm shadow-lg hover:opacity-90 transition-opacity disabled:pointer-events-none disabled:opacity-45"
            >
              Send a Wave 👋
            </button>
          </motion.div>
        ) : (
          <div ref={threadContentRef} className="w-full max-w-2xl mx-auto space-y-0 px-0.5 sm:px-0">
            {hasNextPage ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/45 bg-secondary/25 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/45 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                  aria-label="Load older messages"
                  title="Load older messages"
                >
                  {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {isFetchingNextPage ? "Loading older" : "Load older messages"}
                </button>
              </div>
            ) : null}
            {rowsWithLayout.map(({ row, isFirstInGroup, isLastInGroup, showAvatar }) => {
              if (row.type === "pending_games_summary") {
                return (
                  <div
                    key={row.clusterKey}
                    className={cn("flex justify-center w-full px-1", isFirstInGroup ? "mt-2" : "mt-1")}
                  >
                    <button
                      type="button"
                      className="rounded-full border border-border/30 bg-muted/20 px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/35 transition-colors"
                      onClick={() => setExpandedPendingClusterKey(row.clusterKey)}
                      aria-label={`Show ${row.hidden.length} earlier open game${row.hidden.length === 1 ? "" : "s"}`}
                      title="Show earlier games"
                    >
                      {row.hidden.length} earlier open game{row.hidden.length === 1 ? "" : "s"} · Show
                    </button>
                  </div>
                );
              }
              if (row.type === "pending_games_collapse") {
                return (
                  <div key={`cg-${row.clusterKey}`} className="flex justify-center w-full mt-2 mb-0.5">
                    <button
                      type="button"
                      className="text-[10px] font-medium text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => setExpandedPendingClusterKey(null)}
                      aria-label="Collapse earlier games"
                      title="Collapse earlier games"
                    >
                      Collapse earlier games
                    </button>
                  </div>
                );
              }
              const message = row.message;
              const groupedMessage = { ...message, isFirstInGroup, isLastInGroup, showAvatar };
              const threadIdx = displayMessages.findIndex((m) => m.id === message.id);
              const mediaRecede =
                threadIdx >= 0 && lastClipOrVideoIndex >= 0 && threadIdx < lastClipOrVideoIndex;

              return groupedMessage.type === "date-suggestion" || groupedMessage.type === "date-suggestion-event" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-2" : "mt-1",
                  )}
                >
                  <div className="max-w-[min(92%,22rem)] w-full">
                    {groupedMessage.refId && suggestionById.get(groupedMessage.refId) ? (
                      <DateSuggestionCard
                        suggestion={suggestionById.get(groupedMessage.refId)!}
                        currentUserId={currentUserId}
                        partnerName={otherUser.name}
                        partnerUserId={chatData?.otherUser?.id ?? id ?? ""}
                        onOpenComposer={handleOpenDateComposer}
                        onShareMyScheduleAsCounter={openShareScheduleAsCounter}
                        onEditScheduleShareSlots={openEditScheduleShareSlots}
                        onUpdated={onDateSuggestionUpdated}
                        threadUi={row.dateUi}
                        highlightToken={
                          focusedSuggestionId === groupedMessage.refId ? focusToken : undefined
                        }
                      />
                    ) : (
                      <div className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Loading date suggestion…
                      </div>
                    )}
                  </div>
                </div>
              ) : groupedMessage.type === "vibe-game-session" && groupedMessage.gameSessionView ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-2" : "mt-1",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[min(92%,22rem)] w-full overflow-hidden transition-opacity duration-200",
                      groupedMessage.gameSessionView.status === "complete" && "opacity-[0.9] saturate-[0.92]",
                    )}
                  >
                    {(() => {
                      const payload = webGamePayloadFromSessionView(groupedMessage.gameSessionView);
                      if (!payload) return null;
                      const hydratedGameMessage: GameMessage = {
                        id: groupedMessage.id,
                        senderId: groupedMessage.gameSessionView.starterUserId ?? "",
                        type: "game_interactive",
                        sender: groupedMessage.sender,
                        time: groupedMessage.time,
                        gamePayload: payload,
                      };
                      return (
                        <GameBubbleRenderer
                          message={hydratedGameMessage}
                          matchName={otherUser.name}
                          sessionCreatedAt={groupedMessage.gameSessionView.createdAt}
                          onGameUpdate={(_, __, updates) =>
                            submitPersistedGameAction(groupedMessage.gameSessionView!, payload, updates)
                          }
                        />
                      );
                    })()}
                  </div>
                </div>
              ) : groupedMessage.type === "vibe_clip" ? (
                <VibeClipMessageRow
                  key={groupedMessage.id}
                  message={groupedMessage}
                  otherUser={otherUser}
                  threadMessageCount={displayMessages.length}
                  immersiveVideoUrl={videoLightbox?.url ?? null}
                  onRequestImmersiveVideo={setVideoLightbox}
                  videoUrlOverride={videoUrlOverridesById[groupedMessage.id]}
                  thumbnailUrlOverride={thumbnailUrlOverridesById[groupedMessage.id] ?? null}
                  onResolvedVideoUrl={rememberResolvedVideoUrl}
                  onResolvedThumbnailUrl={rememberResolvedThumbnailUrl}
                  onReplyWithClip={openVibeClipOptions}
                  onVoiceReply={() => scrollToBottom()}
                  onSuggestDate={() =>
                    handleOpenDateComposer({ mode: "new", launchFrom: "vibe_clip" })
                  }
                  onReactionPick={(emoji) => handleReaction(groupedMessage.id, emoji)}
                  threadVisualRecede={mediaRecede}
                  localOutboxItem={groupedMessage.outboxItemId ? outboxItemsById.get(groupedMessage.outboxItemId) : undefined}
                  onResumeOutbox={
                    groupedMessage.outboxItemId ? () => webOutbox.retry(groupedMessage.outboxItemId!) : undefined
                  }
                  onDiscardOutboxAndSendAgain={
                    groupedMessage.outboxItemId
                      ? () => {
                          webOutbox.remove(groupedMessage.outboxItemId!);
                          openVibeClipOptions();
                        }
                      : undefined
                  }
                />
              ) : groupedMessage.type === "video" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex items-end gap-2",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-2" : "mt-1",
                  )}
                >
                  {groupedMessage.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {groupedMessage.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div>
                    <VideoMessageBubble
                      videoUrl={videoUrlForMessage(groupedMessage) ?? groupedMessage.videoUrl!}
                      videoSourceRef={groupedMessage.videoSourceRef}
                      messageId={groupedMessage.id}
                      mediaKind="video"
                      onResolvedVideoUrl={(url) => rememberResolvedVideoUrl(groupedMessage.id, url)}
                      duration={groupedMessage.videoDuration || 0}
                      isMine={groupedMessage.sender === "me"}
                      onRequestImmersive={
                        groupedMessage.videoUrl
                          ? () =>
                              setVideoLightbox({
                                url: videoUrlForMessage(groupedMessage) ?? groupedMessage.videoUrl!,
                                posterUrl: null,
                                messageId: groupedMessage.id,
                                videoSourceRef: groupedMessage.videoSourceRef,
                                mediaKind: "video",
                              })
                          : undefined
                      }
                      immersiveActive={
                        !!groupedMessage.videoUrl &&
                        videoLightbox?.url === (videoUrlForMessage(groupedMessage) ?? groupedMessage.videoUrl)
                      }
                      threadVisualRecede={mediaRecede}
                    />
                    {groupedMessage.isLastInGroup && (
                      <div
                        className={cn(
                          "mt-1 flex",
                          groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                        )}
                      >
                        <MessageStatus
                          status={groupedMessage.status || "delivered"}
                          time={groupedMessage.time}
                          isMyMessage={groupedMessage.sender === "me"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : groupedMessage.type === "image" ? (() => {
                const imageUrl = photoUrlForMessage(groupedMessage);
                return (
                  <div
                    key={groupedMessage.id}
                    className={cn(
                      "flex items-end gap-2",
                      groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                      groupedMessage.isFirstInGroup ? "mt-2" : "mt-1",
                    )}
                  >
                    {groupedMessage.sender !== "me" && (
                      <div className="w-7 shrink-0">
                        {groupedMessage.showAvatar && (
                          <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        )}
                      </div>
                    )}
                    <div className="max-w-[min(92%,22rem)]">
                      <button
                        type="button"
                        className="group relative block w-60 max-w-full cursor-zoom-in rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        aria-label="View photo full screen"
                        onClick={() => setPhotoLightboxInitialId(groupedMessage.id)}
                      >
                        {imageUrl?.trim() ? (
                          <span className="block aspect-[4/5] w-60 max-w-full overflow-hidden rounded-2xl border border-border/30 bg-secondary/40">
                            <img
                              src={imageUrl}
                              alt="Shared image"
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:brightness-[1.03] group-active:scale-[0.99]"
                              loading="lazy"
                              onError={() => {
                                void refreshPhotoUrlForMessage(groupedMessage);
                              }}
                            />
                          </span>
                        ) : (
                          <div className="w-60 aspect-[4/5] max-w-full rounded-2xl border border-border/30 bg-muted/40 flex items-center justify-center text-[11px] text-muted-foreground px-2 text-center">
                            Preparing photo…
                          </div>
                        )}
                      </button>
                    {groupedMessage.isLastInGroup && (
                      <div
                        className={cn(
                          "mt-1 flex flex-col gap-1",
                          groupedMessage.sender === "me" ? "items-end" : "items-start",
                        )}
                      >
                        {groupedMessage.sender === "me" && groupedMessage.sendError ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                if (groupedMessage.outboxItemId) {
                                  webOutbox.retry(groupedMessage.outboxItemId);
                                }
                              }}
                              className="text-[10px] underline underline-offset-2 text-muted-foreground hover:text-foreground"
                            >
                              {groupedMessage.sendError}
                            </button>
                            <span className="text-[10px] text-muted-foreground">
                              {groupedMessage.time} · failed
                            </span>
                          </>
                        ) : (
                          <>
                            {groupedMessage.sender === "me" && groupedMessage.statusSubtext ? (
                              <span className="text-[10px] text-muted-foreground">{groupedMessage.statusSubtext}</span>
                            ) : null}
                            <MessageStatus
                              status={groupedMessage.status || "delivered"}
                              time={groupedMessage.time}
                              isMyMessage={groupedMessage.sender === "me"}
                            />
                          </>
                        )}
                      </div>
                    )}
                    </div>
                  </div>
                );
              })() : groupedMessage.type === "voice" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex items-end gap-2",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-2" : "mt-1",
                  )}
                >
                  {groupedMessage.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {groupedMessage.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[min(92%,22rem)] rounded-2xl px-3 py-2",
                      groupedMessage.sender === "me"
                        ? "bg-gradient-primary text-primary-foreground"
                        : "glass-card border border-border/30 text-foreground",
                    )}
                  >
                    <VoiceMessageBubble
                      audioUrl={groupedMessage.audioUrl}
                      audioSourceRef={groupedMessage.audioSourceRef}
                      messageId={groupedMessage.id}
                      duration={groupedMessage.audioDuration || 0}
                      isMine={groupedMessage.sender === "me"}
                    />
                  </div>
                </div>
              ) : groupedMessage.type === "text" ? (
                <MessageBubble
                  key={groupedMessage.id}
                  message={groupedMessage as TextMessage}
                  isFirstInGroup={groupedMessage.isFirstInGroup}
                  isLastInGroup={groupedMessage.isLastInGroup}
                  showAvatar={groupedMessage.showAvatar}
                  avatarUrl={otherUser.avatar_url}
                  onReaction={handleReaction}
                  onRetryFailedSend={(mid) => {
                    if (mid.startsWith("outbox-")) {
                      webOutbox.retry(mid.slice("outbox-".length));
                    }
                  }}
                />
              ) : null;
            })}

            <AnimatePresence>
              {partnerTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <TypingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {!isLoadingChat && awayFromBottom && displayMessages.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center z-20">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/92 backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-foreground shadow-lg shadow-black/10 hover:bg-background transition-colors"
            aria-label={newBelowCue ? "Jump to new messages" : "Jump to latest message"}
            title={newBelowCue ? "New below" : "Latest"}
          >
            <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden />
            {newBelowCue ? "New below" : "Latest"}
          </button>
        </div>
      ) : null}
      </div>

      {/* Input Area */}
      <div ref={composerChromeRef} className="relative z-40 shrink-0">
        <DateSuggestionChip
          visible={showDateSuggestion}
          onSuggest={handleOpenDateComposerFromChip}
          onDismiss={() => setShowDateSuggestion(false)}
        />

        <div className="px-2 pb-0 pt-0">
          <div className="max-w-2xl mx-auto flex items-stretch justify-center gap-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={handleOpenDateComposerFromChip}
              disabled={!hasActiveConversation}
              className="flex-1 min-w-0 h-7 px-2 rounded-full border border-border/40 bg-secondary/25 text-foreground/90 hover:bg-secondary/40 transition-colors inline-flex items-center justify-center gap-1 disabled:pointer-events-none disabled:opacity-45"
              aria-label="Suggest a Date"
              title="Suggest a date"
            >
              <CalendarPlus className="w-3 h-3 shrink-0 text-rose-400/95" />
              <span className="text-[11px] font-medium truncate tracking-tight">Date</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={openArcade}
              disabled={!hasActiveConversation}
              className="flex-1 min-w-0 h-7 px-2 rounded-full border border-border/40 bg-secondary/25 text-foreground/90 hover:bg-secondary/40 transition-colors inline-flex items-center justify-center gap-1 disabled:pointer-events-none disabled:opacity-45"
              aria-label="Open Games"
              title="Open games"
            >
              <Gamepad2 className="w-3 h-3 shrink-0 text-cyan-400/90" />
              <span className="text-[11px] font-medium truncate tracking-tight">Games</span>
            </motion.button>
          </div>
        </div>

        <AnimatePresence>
          {showAttachmentTray ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="px-2 py-1"
            >
              <div
                className="max-w-2xl mx-auto grid grid-cols-3 gap-1.5 rounded-2xl border border-border/40 bg-background/92 p-1.5 shadow-lg shadow-black/15 backdrop-blur-md"
                data-testid="chat-attachment-tray"
              >
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  disabled={composerMediaLocked || !hasActiveConversation}
                  className="h-9 rounded-xl bg-secondary/45 text-xs font-medium text-foreground/90 transition-colors hover:bg-secondary/70 disabled:pointer-events-none disabled:opacity-45 inline-flex items-center justify-center gap-1.5"
                  aria-label="Add photo"
                  title="Add photo"
                  data-testid="chat-add-photo"
                >
                  {sendingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  Photo
                </button>
                <button
                  type="button"
                  onClick={openVibeClipOptions}
                  disabled={composerMediaLocked || !hasActiveConversation}
                  className="h-9 rounded-xl bg-violet-500/14 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-500/24 disabled:pointer-events-none disabled:opacity-45 inline-flex items-center justify-center gap-1.5"
                  aria-label={VIBE_CLIP_CHAT_FILM_BUTTON_TITLE}
                  title={VIBE_CLIP_CHAT_FILM_BUTTON_TITLE}
                  data-testid="chat-add-vibe-clip"
                >
                  <Film className="h-3.5 w-3.5" />
                  Clip
                </button>
                <button
                  type="button"
                  onClick={openScheduleShare}
                  disabled={!hasActiveConversation}
                  className="h-9 rounded-xl bg-secondary/45 text-xs font-medium text-foreground/90 transition-colors hover:bg-secondary/70 disabled:pointer-events-none disabled:opacity-45 inline-flex items-center justify-center gap-1.5"
                  aria-label="Vibely schedule"
                  title="Vibely schedule"
                  data-testid="chat-share-schedule"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-cyan-300" />
                  Schedule
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Input bar */}
        <div className="glass-card border-t border-border/35 px-2 py-1 pb-safe">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={handlePhotoFileChange}
          />
          <div className="flex items-end gap-1 max-w-2xl mx-auto">
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                disabled={!hasActiveConversation || composerMediaLocked}
                onClick={() => setShowAttachmentTray((open) => !open)}
                className={cn(
                  CHAT_COMPOSER_CONTROL_CLASS,
                  "rounded-full flex items-center justify-center transition-colors",
                  "bg-secondary/35 text-muted-foreground hover:bg-secondary/55 hover:text-foreground",
                  "disabled:opacity-45 disabled:pointer-events-none"
                )}
                aria-label={showAttachmentTray ? "Close attachments" : "Open attachments"}
                aria-expanded={showAttachmentTray}
                title={showAttachmentTray ? "Close attachments" : "Attachments"}
                data-testid="chat-attachment-toggle"
              >
                {showAttachmentTray ? <X className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
              </motion.button>
            </div>

            {/* Text input */}
            <div className="flex-1 min-w-0">
              <textarea
                ref={inputRef}
                placeholder="Message"
                value={newMessage}
                onChange={(e) => handleComposerChange(e.target.value)}
                onFocus={handleComposerFocus}
                onBlur={handleComposerBlur}
                onKeyPress={handleKeyPress}
                disabled={!hasActiveConversation || isRecording}
                aria-label="Message"
                title={hasActiveConversation ? "Message" : "No active conversation"}
                rows={1}
                className="block box-border w-full min-h-10 text-[15px] leading-5 px-3 py-[9px] rounded-[20px] border border-border/45 bg-background/55 text-foreground placeholder:text-muted-foreground/55 placeholder:font-normal resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all max-h-32 disabled:opacity-55"
                style={{
                  height: "auto",
                }}
              />
            </div>

            {/* Send / Mic button */}
            {hasText && !isRecording ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={handleSend}
                disabled={!hasActiveConversation}
                className={cn(
                  "shrink-0 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-md disabled:opacity-45 disabled:pointer-events-none",
                  CHAT_COMPOSER_CONTROL_CLASS
                )}
                aria-label="Send message"
                title="Send"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Send className="w-[18px] h-[18px]" />
                </motion.div>
              </motion.button>
            ) : (
              <Suspense
                fallback={
                  <button
                    type="button"
                    disabled
                    className={cn(
                      "shrink-0 rounded-full bg-secondary/45 flex items-center justify-center text-muted-foreground",
                      CHAT_COMPOSER_CONTROL_CLASS
                    )}
                    aria-label="Voice message loading"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </button>
                }
              >
                <VoiceRecorder
                  disabled={!hasActiveConversation || composerMediaLocked}
                  onUnavailable={() => toast.error("No active conversation found")}
                  onRecordingStart={handleVoiceRecordingStart}
                  onRecordingComplete={handleVoiceRecordingComplete}
                  onCancel={handleVoiceRecordingCancel}
                  className={CHAT_COMPOSER_CONTROL_CLASS}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
        </div>

        <aside className="hidden min-h-0 w-72 shrink-0 overflow-hidden border-l border-border/35 bg-[#09090d]/72 px-4 py-4 xl:flex xl:flex-col">
          <ProfileDetailDrawer
            match={{
              id: otherUser.id,
              name: otherUser.name,
              age: otherUser.age,
              image: otherUser.avatar_url,
              vibes: otherUser.vibes,
              photos: otherUser.photos,
              photoVerified: otherUser.photoVerified,
              bunnyVideoUid: otherUser.bunnyVideoUid,
            }}
            showActions={false}
            mode="match"
            trigger={
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                aria-label={`Open ${otherUser.name}'s profile`}
              >
                <img
                  src={otherUser.avatar_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-primary/25"
                  loading="eager"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {otherUser.name}{otherUser.age ? `, ${otherUser.age}` : ""}
                  </p>
                  <p className={cn("text-xs", otherUser.isOnline ? "text-green-500" : "text-muted-foreground")}>
                    {otherUser.isOnline ? "Active now" : threadAnchorLabel ?? "Private chat"}
                  </p>
                </div>
              </button>
            }
          />

          <div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
            <div className="border-t border-border/30 pt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Conversation</p>
              <p className="mt-1 text-foreground/90">{threadAnchorLabel ?? "Private chat"}</p>
              {hasNextPage ? (
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                  aria-label="Load earlier messages"
                  title="Load earlier messages"
                >
                  {isFetchingNextPage ? "Loading..." : "Earlier messages"}
                </button>
              ) : null}
            </div>
            <div className="border-t border-border/30 pt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Quick Actions</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleOpenDateComposerFromChip}
                  disabled={!hasActiveConversation}
                  className={quickActionButtonClass}
                  aria-label="Open date planner"
                  title="Date"
                >
                  <CalendarPlus className="h-4 w-4 shrink-0 text-rose-400/95" aria-hidden />
                  <span className="truncate">Date</span>
                </button>
                <button
                  type="button"
                  onClick={openArcade}
                  disabled={!hasActiveConversation}
                  className={quickActionButtonClass}
                  aria-label="Open games"
                  title="Games"
                >
                  <Gamepad2 className="h-4 w-4 shrink-0 text-cyan-400/90" aria-hidden />
                  <span className="truncate">Games</span>
                </button>
                <button
                  type="button"
                  onClick={() => startMatchCall("voice")}
                  disabled={!chatData?.matchId}
                  className={quickActionButtonClass}
                  aria-label="Start voice call"
                  title="Voice Call"
                >
                  <Phone className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                  <span className="truncate">Voice Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => startMatchCall("video")}
                  disabled={!chatData?.matchId}
                  className={quickActionButtonClass}
                  aria-label="Start video call"
                  title="Video Call"
                >
                  <Video className="h-4 w-4 shrink-0 text-violet-300" aria-hidden />
                  <span className="truncate">Video Call</span>
                </button>
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  disabled={composerMediaLocked || !hasActiveConversation}
                  className={quickActionButtonClass}
                  aria-label="Add photo"
                  title="Photo"
                >
                  {sendingPhoto ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Camera className="h-4 w-4 shrink-0 text-pink-300" aria-hidden />
                  )}
                  <span className="truncate">Photo</span>
                </button>
                <button
                  type="button"
                  onClick={openVibeClipOptions}
                  disabled={composerMediaLocked || !hasActiveConversation}
                  className={quickActionButtonClass}
                  aria-label={VIBE_CLIP_CHAT_FILM_BUTTON_TITLE}
                  title="Clip"
                >
                  <Film className="h-4 w-4 shrink-0 text-violet-300" aria-hidden />
                  <span className="truncate">Clip</span>
                </button>
                <Suspense
                  fallback={
                    <button
                      type="button"
                      disabled
                      className={quickActionButtonClass}
                      aria-label="Voice note loading"
                      title="Voice Note"
                    >
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      <span className="whitespace-nowrap">Voice Note</span>
                    </button>
                  }
                >
                  <VoiceRecorder
                    variant="action"
                    label="Voice Note"
                    disabled={!hasActiveConversation || hasText || composerMediaLocked}
                    onUnavailable={() => toast.error("No active conversation found")}
                    onRecordingStart={handleVoiceRecordingStart}
                    onRecordingComplete={handleVoiceRecordingComplete}
                    onCancel={handleVoiceRecordingCancel}
                    className={quickActionButtonClass}
                  />
                </Suspense>
                <button
                  type="button"
                  onClick={openScheduleShare}
                  disabled={!hasActiveConversation}
                  className={quickActionButtonClass}
                  aria-label="Share Vibely Schedule"
                  title="Schedule"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-neon-cyan" aria-hidden />
                  <span className="whitespace-nowrap">Schedule</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <Suspense fallback={null}>
        <PhotoSendOptionsDialog
          open={showPhotoOptions}
          onOpenChange={setShowPhotoOptions}
          onTakePhoto={openPhotoCamera}
          onChooseLibrary={triggerPhotoFilePicker}
          disabled={composerMediaLocked || !hasActiveConversation || sendingPhoto}
        />

        <PhotoCameraCaptureDialog
          open={showPhotoCamera}
          onOpenChange={setShowPhotoCamera}
          onCapturePhoto={queuePhotoFile}
          disabled={sendingPhoto}
        />

        <VibeClipSendOptionsSheet
          open={showVibeClipOptions}
          onOpenChange={setShowVibeClipOptions}
          onRecord={startVibeClipRecorder}
          onLibraryClipReady={handleVibeClipLibraryReady}
          disabled={composerMediaLocked || !hasActiveConversation}
          promptSeed={chatData?.matchId ?? id ?? ""}
        />

        {/* Video recording overlay */}
        <AnimatePresence>
          {isRecordingVideo && (
            <VideoMessageRecorder
              promptSeed={chatData?.matchId ?? id ?? ""}
              onRecordingComplete={handleVideoRecordingComplete}
              onCancel={() => setIsRecordingVideo(false)}
              showLibraryUpload={false}
            />
          )}
        </AnimatePresence>

        {chatData?.matchId && currentUserId && (
          <DateSuggestionComposer
            open={showDateComposer}
            onClose={closeDateComposer}
            matchId={chatData.matchId}
            currentUserId={currentUserId}
            partnerUserId={chatData.otherUser?.id ?? id ?? ""}
            partnerName={otherUser.name}
            draftSuggestionId={composerDraftId}
            draftFromParent={
              composerDraftPayload &&
              typeof composerDraftPayload === "object" &&
              ("wizard" in composerDraftPayload || "step" in composerDraftPayload)
                ? {
                    wizard: (composerDraftPayload as { wizard?: Partial<WizardState> }).wizard,
                    step: (composerDraftPayload as { step?: number }).step,
                  }
                : null
            }
            counterContext={composerCounter}
            onSuccess={() => {
              void refetchDateSuggestions();
              if (id && currentUserId) {
                queryClient.invalidateQueries({
                  queryKey: threadMessagesQueryKey(id, currentUserId),
                  exact: true,
                });
              }
            }}
            launchSource={dateComposerLaunchSource}
            threadMessageCount={displayMessages.length}
            onActiveSuggestionConflict={warnAboutActiveSuggestion}
          />
        )}

        {chatData?.matchId && (
          <ScheduleShareSheet
            isOpen={showScheduleShare}
            onClose={() => setShowScheduleShare(false)}
            matchId={chatData.matchId}
            partnerName={otherUser.name}
            onActiveSuggestionConflict={warnAboutActiveSuggestion}
            onSent={() => {
              void refetchDateSuggestions();
              if (id && currentUserId) {
                queryClient.invalidateQueries({
                  queryKey: threadMessagesQueryKey(id, currentUserId),
                  exact: true,
                });
              }
            }}
          />
        )}

        {chatData?.matchId && currentUserId && editScheduleShareSuggestionId && (
          <ScheduleShareEditSheet
            isOpen={editScheduleShareSuggestionId !== null}
            onClose={() => setEditScheduleShareSuggestionId(null)}
            matchId={chatData.matchId}
            suggestionId={editScheduleShareSuggestionId}
            currentUserId={currentUserId}
            partnerName={otherUser.name}
            onSaved={() => {
              void refetchDateSuggestions();
              // Refresh the shared schedule cache (both sides) so the sender's
              // updated grant slot set reflects immediately on the card.
              queryClient.invalidateQueries({ queryKey: ["shared-schedule"] });
              // Refresh the sender's own user-schedule cache (no event-lock
              // change is expected here, but adding/removing open blocks via
              // the picker is possible).
              queryClient.invalidateQueries({ queryKey: ["user-schedule"] });
              if (id && currentUserId) {
                queryClient.invalidateQueries({
                  queryKey: threadMessagesQueryKey(id, currentUserId),
                  exact: true,
                });
              }
            }}
          />
        )}

        <ActiveDateSuggestionWarningDialog
          open={showActiveDateSuggestionWarning}
          onOpenChange={handleActiveDateSuggestionWarningOpenChange}
        />

        <VibeArcadeMenu
          isOpen={showArcade}
          onClose={() => setShowArcade(false)}
          onSelectGame={handleGameSelect}
        />

        <TwoTruthsCreator
          isOpen={activeGameCreator === "2truths"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(statements, lieIndex) =>
            submitGameStart({ gameType: "2truths", step: "active", data: { statements, lieIndex } })
          }
        />
        <WouldRatherCreator
          isOpen={activeGameCreator === "would_rather"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(optionA, optionB, vote) =>
            submitGameStart({ gameType: "would_rather", step: "active", data: { optionA, optionB, senderVote: vote } })
          }
        />
        <CharadesCreator
          isOpen={activeGameCreator === "charades"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(answer, emojis) =>
            submitGameStart({ gameType: "charades", step: "active", data: { answer, emojis, guesses: [] } })
          }
        />
        <ScavengerCreator
          isOpen={activeGameCreator === "scavenger"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(prompt, photoUrl) =>
            submitGameStart({
              gameType: "scavenger",
              step: "active",
              data: { prompt, senderPhotoUrl: photoUrl, isUnlocked: false },
            })
          }
        />
        <RouletteCreator
          isOpen={activeGameCreator === "roulette"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(question, answer) =>
            submitGameStart({
              gameType: "roulette",
              step: "active",
              data: { question, senderAnswer: answer, isUnlocked: false },
            })
          }
        />
        <IntuitionCreator
          isOpen={activeGameCreator === "intuition"}
          onClose={() => setActiveGameCreator(null)}
          onSubmit={(options, prediction) =>
            submitGameStart({
              gameType: "intuition",
              step: "active",
              data: { prediction: options[prediction], options, senderChoice: prediction },
            })
          }
          matchName={otherUser.name}
        />
        <AnimatePresence>
          {photoLightboxInitialId && chatPhotoLightboxItems.length > 0 ? (
            <ChatPhotoLightbox
              key="chat-photo-lightbox"
              items={chatPhotoLightboxItems}
              initialId={photoLightboxInitialId}
              onRefreshItem={refreshPhotoLightboxItem}
              onClose={() => setPhotoLightboxInitialId(null)}
            />
          ) : null}
          {videoLightbox ? (
            <ChatVideoLightbox
              key="chat-video-lightbox"
              videoUrl={videoLightbox.url}
              posterUrl={videoLightbox.posterUrl}
              messageId={videoLightbox.messageId}
              videoSourceRef={videoLightbox.videoSourceRef}
              thumbnailSourceRef={videoLightbox.thumbnailSourceRef}
              mediaKind={videoLightbox.mediaKind}
              onResolvedVideoUrl={(url) => {
                if (videoLightbox.messageId) rememberResolvedVideoUrl(videoLightbox.messageId, url);
              }}
              onResolvedThumbnailUrl={(url) => {
                if (videoLightbox.messageId) rememberResolvedThumbnailUrl(videoLightbox.messageId, url);
              }}
              onClose={() => setVideoLightbox(null)}
            />
          ) : null}
        </AnimatePresence>
      </Suspense>
    </div>
  );
};

export default Chat;
