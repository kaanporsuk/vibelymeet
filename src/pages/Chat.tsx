import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import * as Sentry from "@sentry/react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";
import { uploadChatVideoToBunny } from "@/services/chatVideoUploadService";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { getImageUrl } from "@/utils/imageUrl";
import {
  Send,
  Film,
  Camera,
  Loader2,
  CalendarDays,
  CalendarPlus,
  Gamepad2,
  ChevronDown,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader, type ChatHeaderActivityLine } from "@/components/chat/ChatHeader";
import { ChatThreadSkeleton } from "@/components/chat/ChatThreadSkeleton";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import VideoMessageRecorder from "@/components/chat/VideoMessageRecorder";
import { VoiceMessageBubble } from "@/components/chat/VoiceMessageBubble";
import { VideoMessageBubble } from "@/components/chat/VideoMessageBubble";
import { VibeClipBubble } from "@/components/chat/VibeClipBubble";
import { ChatPhotoLightbox } from "@/components/chat/ChatPhotoLightbox";
import { ChatVideoLightbox } from "@/components/chat/ChatVideoLightbox";
import { MessageStatus } from "@/components/chat/MessageStatus";
import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageMessageContent,
} from "@/lib/chatMessageContent";
import { extractVibeClipMeta } from "../../shared/chat/messageRouting";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { VibeSyncModal } from "@/components/schedule/VibeSyncModal";
import { DateSuggestionComposer } from "@/components/chat/DateSuggestionComposer";
import { DateSuggestionCard } from "@/components/chat/DateSuggestionCard";
import { useMatchDateSuggestions } from "@/hooks/useDateSuggestionData";
import type { DateSuggestionWithRelations } from "@/hooks/useDateSuggestionData";
import type { WizardState } from "@/components/chat/DateSuggestionComposer";
import { VibeArcadeMenu } from "@/components/arcade/VibeArcadeMenu";
import { GameBubbleRenderer } from "@/components/arcade/GameBubbleRenderer";
import { TwoTruthsCreator } from "@/components/arcade/creators/TwoTruthsCreator";
import { WouldRatherCreator } from "@/components/arcade/creators/WouldRatherCreator";
import { CharadesCreator } from "@/components/arcade/creators/CharadesCreator";
import { ScavengerCreator } from "@/components/arcade/creators/ScavengerCreator";
import { RouletteCreator } from "@/components/arcade/creators/RouletteCreator";
import { IntuitionCreator } from "@/components/arcade/creators/IntuitionCreator";
import { GameType, GameMessage, GamePayload } from "@/types/games";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { useTypingBroadcast } from "@/hooks/useTypingBroadcast";
import { useMessageReactions } from "@/hooks/useMessageReactions";
import { useMessages, useSendMessage, usePublishVibeClip, usePublishVoiceMessage } from "@/hooks/useMessages";
import { setMessageReaction } from "@/lib/messageReactions";
import { reactionPairFromRows, type ReactionPair, type MessageReactionRow } from "../../shared/chat/messageReactionModel";
import { webGamePayloadFromSessionView, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";
import { formatSendGameEventError, newVibeGameSessionId, sendGameEvent } from "@/lib/webGamesApi";
import { dedupeLatestByRefId } from "../../shared/chat/refDedupe";
import type { DateComposerLaunchSource } from "../../shared/dateSuggestions/dateComposerLaunch";
import { matchHasOpenDateSuggestion } from "../../shared/dateSuggestions/openStatus";
import {
  VIBE_CLIP_CHAT_FILM_BUTTON_TITLE,
  VIBE_CLIP_TOAST_SEND_FAIL,
  VIBE_CLIP_TOAST_SENT,
  VIBE_CLIP_TOAST_UPLOAD_FAIL,
} from "../../shared/chat/vibeClipCaptureCopy";
import {
  classifySendFailureMessage,
  durationBucketFromSeconds,
  threadBucketFromCount,
} from "../../shared/chat/vibeClipAnalytics";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import { useUserProfile } from "@/contexts/AuthContext";
import { useMatchCall } from "@/hooks/useMatchCall";
import { IncomingCallOverlay } from "@/components/chat/IncomingCallOverlay";
import { ActiveCallOverlay } from "@/components/chat/ActiveCallOverlay";
import { threadMessagesQueryKey } from "../../shared/chat/queryKeys";
import { format } from "date-fns";
import { buildThreadPresentationRows } from "../../shared/chat/threadPresentation";

type MessageStatusType = "sending" | "sent" | "delivered" | "read";
type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

const DATE_SUGGESTION_KEYWORDS = ["free", "video", "call", "meet", "date", "tonight", "later", "available"];

function clientRequestIdFromStructured(p: Record<string, unknown> | null | undefined): string | null {
  if (!p || typeof p !== "object") return null;
  const id = (p as { client_request_id?: unknown }).client_request_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  type: "text" | "image" | "voice" | "video" | "vibe_clip" | "date-suggestion" | "date-suggestion-event" | "vibe-game-session";
  duration?: number;
  audioBlob?: Blob;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  videoDuration?: number;
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
}

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
  threadVisualRecede,
}: {
  message: ChatMessage & { isFirstInGroup?: boolean; isLastInGroup?: boolean; showAvatar?: boolean };
  otherUser: { avatar_url: string | null } | null;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
  onSuggestDate?: () => void;
  onReactionPick?: (emoji: ReactionEmoji) => void;
  threadMessageCount: number;
  immersiveVideoUrl: string | null;
  onRequestImmersiveVideo: (url: string, posterUrl?: string | null) => void;
  threadVisualRecede?: boolean;
}) {
  const clipMeta = extractVibeClipMeta({
    video_url: message.videoUrl,
    video_duration_seconds: message.videoDuration,
    structured_payload: (message.structuredPayload as Record<string, unknown>) ?? null,
    message_kind: "vibe_clip",
  });
  const isMine = message.sender === "me";
  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isMine ? "justify-end" : "justify-start",
        message.isFirstInGroup ? "mt-1.5" : "mt-0.5"
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
            threadMessageCount={threadMessageCount}
            sparkMessageId={message.id}
            onReplyWithClip={isMine ? undefined : onReplyWithClip}
            onVoiceReply={isMine ? undefined : onVoiceReply}
            onSuggestDate={isMine ? undefined : onSuggestDate}
            onReactionPick={isMine ? undefined : onReactionPick}
            reactionPair={message.reactionPair}
            onRequestImmersive={() => onRequestImmersiveVideo(clipMeta.videoUrl, clipMeta.thumbnailUrl ?? null)}
            immersiveActive={immersiveVideoUrl === clipMeta.videoUrl}
            threadVisualRecede={threadVisualRecede}
          />
        ) : (
          <VideoMessageBubble
            videoUrl={message.videoUrl!}
            duration={message.videoDuration || 0}
            isMine={isMine}
            onRequestImmersive={
              message.videoUrl ? () => onRequestImmersiveVideo(message.videoUrl!, null) : undefined
            }
            immersiveActive={!!message.videoUrl && immersiveVideoUrl === message.videoUrl}
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
  
  const { data: chatData, isLoading: isLoadingChat } = useMessages(id || "", currentUserId);
  const { mutate: sendMessage } = useSendMessage();
  const publishVibeClip = usePublishVibeClip();
  const publishVoiceMessage = usePublishVoiceMessage();
  const { data: dateSuggestions = [], refetch: refetchDateSuggestions } = useMatchDateSuggestions(
    chatData?.matchId,
  );

  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [localTyping, setLocalTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [showVibeSync, setShowVibeSync] = useState(false);
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
  const [videoLightbox, setVideoLightbox] = useState<{ url: string; posterUrl?: string | null } | null>(null);
  const [expandedPendingClusterKey, setExpandedPendingClusterKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const stickToBottomRef = useRef(true);
  /** True until we have applied the first bottom snap for this thread (avoids onScroll racing before scrollToBottom). */
  const pendingThreadBottomSnapRef = useRef(false);
  const lastThreadCountRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelowCue, setNewBelowCue] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const gameStartLockRef = useRef(false);
  const actionLockRef = useRef<Set<string>>(new Set());
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matchCall = useMatchCall({
    matchId: chatData?.matchId || "",
    onCallEnded: () => {},
  });

  useRealtimeMessages({
    matchId: chatData?.matchId || null,
    threadOtherUserId: id || null,
    threadCurrentUserId: currentUserId || null,
    enabled: !!chatData?.matchId && !!id && !!currentUserId,
  });
  const { partnerTyping } = useTypingBroadcast(
    chatData?.matchId ?? null,
    currentUserId || null,
    localTyping,
    !!(chatData?.matchId && currentUserId),
  );
  const { data: reactionRows = [] } = useMessageReactions(chatData?.matchId);

  const partnerUserId = chatData?.otherUser?.id ?? id ?? "";

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
      const lastSeenAt = ou.last_seen_at ? new Date(ou.last_seen_at) : null;
      const now = new Date();
      const diffMinutes = lastSeenAt ? (now.getTime() - lastSeenAt.getTime()) / 60000 : Infinity;

      const resolvedAvatar = resolvePhotoUrl(ou.photos?.[0]) || resolvePhotoUrl(ou.avatar_url) || "/placeholder.svg";

      return {
        id: ou.id,
        name: ou.name || "Unknown",
        age: ou.age || 0,
        avatar_url: resolvedAvatar,
        photos: Array.isArray(ou.photos)
          ? ou.photos.map((p) => resolvePhotoUrl(typeof p === "string" ? p : "")).filter(Boolean) as string[]
          : [],
        vibes: [] as string[],
        isOnline: diffMinutes <= 5,
        photoVerified: ou.photo_verified || false,
        subscription_tier: ou.subscription_tier ?? null,
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

  const messages: ChatMessage[] = useMemo(() => {
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
          status: "delivered" as MessageStatusType,
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
          status: "delivered" as MessageStatusType,
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
        audioDuration: m.audioDuration,
        videoUrl: m.videoUrl,
        videoDuration: m.videoDuration,
        structuredPayload: m.structuredPayload ?? undefined,
        status: "delivered" as MessageStatusType,
        reactionPair: pair,
        sortAtMs,
      };
    });
    return mergeServerAndLocalChatMessages(realMsgs, localMessages);
  }, [chatData?.messages, localMessages, reactionByMessageId]);

  const displayMessages = useMemo(() => {
    return dedupeLatestByRefId(messages, {
      isDedupeCandidate: (m) => m.type === "date-suggestion" || m.type === "date-suggestion-event",
      getRefId: (m) => m.refId,
      getId: (m) => m.id,
    });
  }, [messages]);

  const chatPhotoLightboxItems = useMemo(() => {
    const out: { id: string; url: string }[] = [];
    for (const m of displayMessages) {
      if (m.type !== "image") continue;
      const url = parseChatImageMessageContent(m.text);
      if (!url) continue;
      out.push({ id: m.id, url });
    }
    return out;
  }, [displayMessages]);

  useEffect(() => {
    if (!showDateComposer || dateComposerLaunchSource !== "vibe_clip") return;
    trackVibeClipEvent("clip_date_flow_opened", {
      launched_from: "clip_context",
      thread_bucket: threadBucketFromCount(displayMessages.length),
    });
    // Intentionally omit displayMessages.length: avoid duplicate events if thread updates while composer stays open.
  }, [showDateComposer, dateComposerLaunchSource]);

  const suggestionById = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of dateSuggestions) {
      map.set(s.id, s);
    }
    return map;
  }, [dateSuggestions]);

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
      } finally {
        actionLockRef.current.delete(view.gameSessionId);
      }
    },
    [chatData?.matchId, currentUserId, id, queryClient]
  );

  const scrollToBottom = useCallback((opts?: { instant?: boolean }) => {
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    setNewBelowCue(false);
    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: opts?.instant ? "auto" : "smooth",
    });
  }, []);

  const onMainScroll = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceFromBottom < 120;
    stickToBottomRef.current = atBottom;
    setAwayFromBottom(distanceFromBottom > 140);
    if (atBottom) setNewBelowCue(false);
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
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [id, isLoadingChat, displayMessages.length, rowsWithLayout]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom();
  }, [rowsWithLayout, scrollToBottom]);

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
    if (!node) return;
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [id, isLoadingChat, displayMessages.length]);

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
    (opts?: { tempId?: string; text?: string }) => {
      const text = (opts?.text ?? newMessage).trim();
      if (!text) return;
      if (!chatData?.matchId) {
        toast.error("No active conversation found");
        return;
      }
      if (!threadInvalidateScope) {
        toast.error("No active conversation found");
        return;
      }
      const createdAtMs = Date.now();
      const clientRequestId = crypto.randomUUID();
      const tempId = opts?.tempId ?? `temp-${createdAtMs}`;
      const optimisticKind = inferChatMediaRenderKind({ content: text });
      const tempMsg: ChatMessage = {
        id: tempId,
        text,
        sender: "me",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        type: optimisticKind === "image" ? "image" : "text",
        status: "sending",
        sortAtMs: createdAtMs,
        clientRequestId,
      };
      if (!opts?.tempId) {
        setLocalMessages((prev) => [...prev, tempMsg]);
      } else {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  status: "sending",
                  sendError: undefined,
                  clientRequestId,
                  sortAtMs: createdAtMs,
                }
              : m,
          ),
        );
      }
      sendMessage(
        {
          matchId: chatData.matchId,
          content: text,
          clientRequestId,
          invalidateScope: threadInvalidateScope,
        },
        {
          onSuccess: (data) => {
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate(12);
            }
            const row = data as { structured_payload?: Record<string, unknown> } | null | undefined;
            const srvCid = clientRequestIdFromStructured(row?.structured_payload ?? null);
            setLocalMessages((prev) =>
              prev.filter((m) => m.id !== tempId && (!srvCid || m.clientRequestId !== srvCid)),
            );
          },
          onError: () => {
            setLocalMessages((prev) =>
              prev.map((m) =>
                m.id === tempId
                  ? { ...m, status: "sent" as MessageStatusType, sendError: "Couldn't send · Tap to retry" }
                  : m,
              ),
            );
            toast.error("Failed to send message");
          },
        },
      );
    },
    [chatData?.matchId, newMessage, sendMessage, threadInvalidateScope],
  );

  const handlePhotoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose an image file");
        return;
      }
      if (!chatData?.matchId || !user?.id) {
        toast.error("Cannot send photo right now");
        return;
      }
      if (!navigator.onLine) {
        toast.error("You're offline — try again when connected");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sign in required");
        return;
      }

      if (!threadInvalidateScope) {
        toast.error("Cannot send photo right now");
        return;
      }
      const createdAtMs = Date.now();
      const clientRequestId = crypto.randomUUID();
      const tempId = `temp-img-${createdAtMs}`;
      setSendingPhoto(true);
      try {
        const path = await uploadImageToBunny(file, session.access_token);
        const publicUrl = getImageUrl(path, { quality: 88 });
        const content = formatChatImageMessageContent(publicUrl);
        const tempMsg: ChatMessage = {
          id: tempId,
          text: content,
          sender: "me",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type: "image",
          status: "sending",
          sortAtMs: createdAtMs,
          clientRequestId,
        };
        setLocalMessages((prev) => [...prev, tempMsg]);
        sendMessage(
          {
            matchId: chatData.matchId,
            content,
            clientRequestId,
            invalidateScope: threadInvalidateScope,
          },
          {
            onSuccess: (data) => {
              if (typeof navigator !== "undefined" && navigator.vibrate) {
                navigator.vibrate(12);
              }
              const row = data as { structured_payload?: Record<string, unknown> } | null | undefined;
              const srvCid = clientRequestIdFromStructured(row?.structured_payload ?? null);
              setLocalMessages((prev) =>
                prev.filter((m) => m.id !== tempId && (!srvCid || m.clientRequestId !== srvCid)),
              );
            },
            onError: () => {
              setLocalMessages((prev) =>
                prev.map((m) =>
                  m.id === tempId
                    ? { ...m, status: "sent" as MessageStatusType, sendError: "Couldn't send · Tap to retry" }
                    : m,
                ),
              );
              toast.error("Failed to send photo");
            },
            onSettled: () => {
              setSendingPhoto(false);
            },
          },
        );
      } catch (err) {
        console.error("Photo upload error:", err);
        toast.error(err instanceof Error ? err.message : "Photo upload failed");
        setSendingPhoto(false);
      }
    },
    [chatData?.matchId, user?.id, sendMessage, threadInvalidateScope]
  );

  const handleSend = () => {
    if (!newMessage.trim()) return;
    if (!navigator.onLine) {
      toast.error("You're offline — message will send when you reconnect");
      return;
    }
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

  const handleOpenDateComposerFromChip = () => {
    if (matchHasOpenDateSuggestion(dateSuggestions)) {
      toast.message(
        "You already have an active date suggestion in this chat. Use the card in the thread to continue, respond, or cancel before starting another.",
      );
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
        if (matchHasOpenDateSuggestion(dateSuggestions)) {
          toast.message(
            "You already have an active date suggestion in this chat. Use the card in the thread to continue, respond, or cancel before starting another.",
          );
          return;
        }
        setComposerCounter(null);
        setComposerDraftId(null);
        setComposerDraftPayload(null);
        setDateComposerLaunchSource(opts.launchFrom ?? "default");
      }
      setShowDateComposer(true);
    },
    [dateSuggestions],
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
  }, [refetchDateSuggestions, queryClient, id, currentUserId]);

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    setIsRecording(false);

    if (!chatData?.matchId || !user?.id) {
      toast.error("Cannot send voice message right now");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const audioUrl = await uploadVoiceToBunny(
        audioBlob,
        session.access_token,
        chatData.matchId
      );

      if (!threadInvalidateScope) {
        toast.error("Cannot send voice message right now");
        return;
      }
      await publishVoiceMessage.mutateAsync({
        matchId: chatData.matchId,
        audioUrl,
        durationSeconds: duration,
        clientRequestId: crypto.randomUUID(),
        invalidateScope: threadInvalidateScope,
      });
    } catch (err) {
      console.error("Voice message error:", err);
      toast.error("Failed to send voice message");
    }
  };

  const handleVideoRecordingComplete = async (videoBlob: Blob, duration: number) => {
    setIsRecordingVideo(false);

    if (!chatData?.matchId || !user?.id) {
      toast.error("Cannot send Vibe Clip right now");
      return;
    }

    const durationBucket = durationBucketFromSeconds(duration);
    const threadBucket = threadBucketFromCount(displayMessages.length);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      trackVibeClipEvent("clip_send_attempted", {
        capture_source: "web_recorder",
        duration_bucket: durationBucket,
        has_poster: false,
        thread_bucket: threadBucket,
        is_sender: true,
      });

      const uploaded = await uploadChatVideoToBunny(
        videoBlob,
        session.access_token,
        chatData.matchId
      );

      const clientRequestId = crypto.randomUUID();

      if (!threadInvalidateScope) {
        toast.error("Cannot send Vibe Clip right now");
        return;
      }
      publishVibeClip.mutate(
        {
          matchId: chatData.matchId,
          videoUrl: uploaded.videoUrl,
          durationMs: Math.round(duration * 1000),
          clientRequestId,
          thumbnailUrl: uploaded.thumbnailUrl,
          aspectRatio: uploaded.aspectRatio,
          invalidateScope: threadInvalidateScope,
        },
        {
          onSuccess: () => {
            trackVibeClipEvent("clip_send_succeeded", {
              duration_bucket: durationBucket,
              has_poster: !!uploaded.thumbnailUrl,
              thread_bucket: threadBucket,
              is_sender: true,
            });
            toast.success(VIBE_CLIP_TOAST_SENT);
          },
          onError: (err) => {
            console.error("Vibe Clip publish error:", err);
            Sentry.captureException(err, { tags: { funnel: "vibe_clip_publish" } });
            trackVibeClipEvent("clip_send_failed", {
              failure_class: classifySendFailureMessage(err instanceof Error ? err.message : "publish"),
            });
            toast.error(VIBE_CLIP_TOAST_SEND_FAIL);
          },
        },
      );
    } catch (err) {
      console.error("Vibe Clip upload error:", err);
      Sentry.captureException(err, { tags: { funnel: "vibe_clip_upload" } });
      trackVibeClipEvent("clip_send_failed", {
        failure_class: classifySendFailureMessage(err instanceof Error ? err.message : "upload"),
      });
      toast.error(VIBE_CLIP_TOAST_UPLOAD_FAIL);
    }
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
  const composerMediaLocked = sendingPhoto || isRecordingVideo;

  return (
    <div className="h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-primary/5 via-transparent to-transparent pointer-events-none" />

      <ChatHeader
        user={otherUser}
        partnerTyping={partnerTyping}
        headerActivity={headerActivity}
        threadAnchorLabel={threadAnchorLabel}
        matchId={chatData?.matchId || undefined}
        onBack={() => navigate("/matches")}
        onVideoCall={(type) => {
          if (chatData?.matchId) {
            matchCall.startCall(type);
          } else {
            toast.error("No active match for calling");
          }
        }}
        onFocusInput={() => inputRef.current?.focus()}
      />

      <div className="flex-1 flex flex-col min-h-0 relative z-10">
      <main
        ref={(el) => {
          mainScrollRef.current = el;
        }}
        onScroll={onMainScroll}
        className="flex-1 overflow-y-auto px-2 sm:px-3 py-1.5 space-y-0 min-h-0"
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
                src={resolvePhotoUrl(otherUser.avatar_url) || ''}
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
              onClick={() => {
                if (!chatData?.matchId || !threadInvalidateScope) return;
                sendMessage({
                  matchId: chatData.matchId,
                  content: "👋",
                  clientRequestId: crypto.randomUUID(),
                  invalidateScope: threadInvalidateScope,
                });
              }}
              className="px-6 py-2.5 rounded-full bg-gradient-primary text-primary-foreground font-medium text-sm shadow-lg hover:opacity-90 transition-opacity"
            >
              Send a Wave 👋
            </button>
          </motion.div>
        ) : (
          <div ref={threadContentRef} className="w-full max-w-lg mx-auto space-y-0">
            {rowsWithLayout.map(({ row, isFirstInGroup, isLastInGroup, showAvatar }) => {
              if (row.type === "pending_games_summary") {
                return (
                  <div
                    key={row.clusterKey}
                    className={cn("flex justify-center w-full px-1", isFirstInGroup ? "mt-1.5" : "mt-0.5")}
                  >
                    <button
                      type="button"
                      className="rounded-full border border-border/30 bg-muted/20 px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/35 transition-colors"
                      onClick={() => setExpandedPendingClusterKey(row.clusterKey)}
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
                    groupedMessage.isFirstInGroup ? "mt-1.5" : "mt-0.5",
                  )}
                >
                  <div className="max-w-[min(92%,252px)] w-full">
                    {groupedMessage.refId && suggestionById.get(groupedMessage.refId) ? (
                      <DateSuggestionCard
                        suggestion={suggestionById.get(groupedMessage.refId)!}
                        currentUserId={currentUserId}
                        partnerName={otherUser.name}
                        partnerUserId={chatData?.otherUser?.id ?? id ?? ""}
                        onOpenComposer={handleOpenDateComposer}
                        onUpdated={onDateSuggestionUpdated}
                        threadUi={row.dateUi}
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
                    groupedMessage.isFirstInGroup ? "mt-1.5" : "mt-0.5",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[min(92%,252px)] w-full overflow-hidden transition-opacity duration-200",
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
                  onRequestImmersiveVideo={(url, posterUrl) => setVideoLightbox({ url, posterUrl })}
                  onReplyWithClip={() => setIsRecordingVideo(true)}
                  onVoiceReply={() => scrollToBottom()}
                  onSuggestDate={() =>
                    handleOpenDateComposer({ mode: "new", launchFrom: "vibe_clip" })
                  }
                  onReactionPick={(emoji) => handleReaction(groupedMessage.id, emoji)}
                  threadVisualRecede={mediaRecede}
                />
              ) : groupedMessage.type === "video" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex items-end gap-2",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-1.5" : "mt-0.5",
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
                      videoUrl={groupedMessage.videoUrl!}
                      duration={groupedMessage.videoDuration || 0}
                      isMine={groupedMessage.sender === "me"}
                      onRequestImmersive={
                        groupedMessage.videoUrl
                          ? () => setVideoLightbox({ url: groupedMessage.videoUrl!, posterUrl: null })
                          : undefined
                      }
                      immersiveActive={
                        !!groupedMessage.videoUrl && videoLightbox?.url === groupedMessage.videoUrl
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
              ) : groupedMessage.type === "image" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex items-end gap-2",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-1.5" : "mt-0.5",
                  )}
                >
                  {groupedMessage.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {groupedMessage.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div className="max-w-[min(85%,18rem)]">
                    <button
                      type="button"
                      className="group relative block w-52 max-w-full cursor-zoom-in rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      aria-label="View photo full screen"
                      onClick={() => setPhotoLightboxInitialId(groupedMessage.id)}
                    >
                      <img
                        src={parseChatImageMessageContent(groupedMessage.text) || ""}
                        alt="Shared image"
                        className="w-52 max-w-full rounded-2xl object-cover border border-border/30 bg-secondary/40 transition-transform duration-200 group-hover:brightness-[1.03] group-active:scale-[0.99]"
                        loading="lazy"
                      />
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
                                const failed = localMessages.find((m) => m.id === groupedMessage.id);
                                if (!failed) return;
                                sendTextMessage({ tempId: failed.id, text: failed.text });
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
                          <MessageStatus
                            status={groupedMessage.status || "delivered"}
                            time={groupedMessage.time}
                            isMyMessage={groupedMessage.sender === "me"}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : groupedMessage.type === "voice" ? (
                <div
                  key={groupedMessage.id}
                  className={cn(
                    "flex items-end gap-2",
                    groupedMessage.sender === "me" ? "justify-end" : "justify-start",
                    groupedMessage.isFirstInGroup ? "mt-1.5" : "mt-0.5",
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
                      "max-w-[min(85%,18rem)] rounded-2xl px-2.5 py-1.5",
                      groupedMessage.sender === "me"
                        ? "bg-gradient-primary text-primary-foreground"
                        : "glass-card border border-border/30 text-foreground",
                    )}
                  >
                    <VoiceMessageBubble
                      audioUrl={groupedMessage.audioUrl}
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
                    const failed = localMessages.find((m) => m.id === mid);
                    if (!failed) return;
                    sendTextMessage({ tempId: failed.id, text: failed.text });
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
          >
            <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden />
            {newBelowCue ? "New below" : "Latest"}
          </button>
        </div>
      ) : null}
      </div>

      {/* Input Area */}
      <div className="relative z-40 shrink-0">
        <DateSuggestionChip
          visible={showDateSuggestion}
          onSuggest={handleOpenDateComposerFromChip}
          onDismiss={() => setShowDateSuggestion(false)}
        />

        <div className="px-2 pb-0 pt-0">
          <div className="max-w-lg mx-auto flex items-stretch justify-center gap-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={handleOpenDateComposerFromChip}
              className="flex-1 min-w-0 h-7 px-2 rounded-full border border-border/40 bg-secondary/25 text-foreground/90 hover:bg-secondary/40 transition-colors inline-flex items-center justify-center gap-1"
              aria-label="Suggest a Date"
            >
              <CalendarPlus className="w-3 h-3 shrink-0 text-rose-400/95" />
              <span className="text-[11px] font-medium truncate tracking-tight">Date</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowArcade(true)}
              className="flex-1 min-w-0 h-7 px-2 rounded-full border border-border/40 bg-secondary/25 text-foreground/90 hover:bg-secondary/40 transition-colors inline-flex items-center justify-center gap-1"
              aria-label="Open Games"
            >
              <Gamepad2 className="w-3 h-3 shrink-0 text-cyan-400/90" />
              <span className="text-[11px] font-medium truncate tracking-tight">Games</span>
            </motion.button>
          </div>
        </div>

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
          <div className="flex items-end gap-1 max-w-lg mx-auto">
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <motion.button
                type="button"
                whileTap={{ scale: composerMediaLocked ? 1 : 0.9 }}
                disabled={composerMediaLocked || !chatData?.matchId}
                onClick={() => {
                  if (composerMediaLocked || !chatData?.matchId) return;
                  if (!navigator.onLine) {
                    toast.error("You're offline — try again when connected");
                    return;
                  }
                  photoInputRef.current?.click();
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                  "bg-secondary/35 text-muted-foreground hover:bg-secondary/55 hover:text-foreground",
                  "disabled:opacity-45 disabled:pointer-events-none"
                )}
                aria-label="Add photo"
                title="Add photo"
              >
                {sendingPhoto ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                ) : (
                  <Camera className="w-3.5 h-3.5" aria-hidden />
                )}
              </motion.button>
              <motion.button
                whileTap={{ scale: composerMediaLocked ? 1 : 0.9 }}
                disabled={composerMediaLocked}
                onClick={() => {
                  if (composerMediaLocked) return;
                  trackVibeClipEvent("clip_entry_opened", {
                    thread_bucket: threadBucketFromCount(displayMessages.length),
                    is_sender: true,
                    launched_from: "chat",
                  });
                  setIsRecordingVideo(true);
                }}
                className="w-8 h-8 rounded-full bg-violet-500/12 text-violet-300 hover:bg-violet-500/22 flex items-center justify-center transition-colors disabled:opacity-45 disabled:pointer-events-none"
                title={VIBE_CLIP_CHAT_FILM_BUTTON_TITLE}
              >
                <Film className="w-3.5 h-3.5" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowVibeSync(true)}
                className="hidden xs:flex w-8 h-8 rounded-full bg-secondary/35 items-center justify-center text-muted-foreground hover:text-neon-cyan hover:bg-secondary/50 transition-colors"
                aria-label="Vibely schedule"
              >
                <CalendarDays className="w-3.5 h-3.5" />
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (matchHasOpenDateSuggestion(dateSuggestions)) {
                    toast.message(
                      "You already have an active date suggestion in this chat. Use the card in the thread to continue, respond, or cancel before starting another.",
                    );
                    return;
                  }
                  setComposerCounter(null);
                  setComposerDraftId(null);
                  setComposerDraftPayload(null);
                  setDateComposerLaunchSource("default");
                  setShowDateComposer(true);
                }}
                className="hidden xs:flex w-8 h-8 rounded-full bg-secondary/35 items-center justify-center text-muted-foreground hover:text-rose-400 hover:bg-secondary/50 transition-colors"
                aria-label="Suggest a date"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowArcade(true)}
                className="hidden xs:flex w-8 h-8 rounded-full bg-secondary/35 items-center justify-center text-muted-foreground hover:text-primary hover:bg-secondary/50 transition-colors"
              >
                <Gamepad2 className="w-3.5 h-3.5" />
              </motion.button>
            </div>

            {/* Text input */}
            <div className="flex-1 min-w-0">
              <textarea
                ref={inputRef}
                placeholder="Message"
                value={newMessage}
                onChange={(e) => handleComposerChange(e.target.value)}
                onKeyPress={handleKeyPress}
                rows={1}
                className="w-full text-[15px] leading-snug px-3 py-2 rounded-2xl border border-border/45 bg-background/55 text-foreground placeholder:text-muted-foreground/55 placeholder:font-normal resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all max-h-32"
                style={{
                  height: "auto",
                  minHeight: "38px",
                }}
              />
            </div>

            {/* Send / Mic button */}
            {hasText ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSend}
                className="shrink-0 w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-md"
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
              <VoiceRecorder
                onRecordingComplete={handleVoiceRecordingComplete}
                onCancel={() => setIsRecording(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Video recording overlay */}
      <AnimatePresence>
        {isRecordingVideo && (
          <VideoMessageRecorder
            promptSeed={chatData?.matchId ?? id ?? ""}
            onRecordingComplete={handleVideoRecordingComplete}
            onCancel={() => setIsRecordingVideo(false)}
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
            if (id && currentUserId) {
              queryClient.invalidateQueries({
                queryKey: threadMessagesQueryKey(id, currentUserId),
                exact: true,
              });
            }
          }}
          launchSource={dateComposerLaunchSource}
          threadMessageCount={displayMessages.length}
        />
      )}

      {/* Vibe Sync Modal */}
      <VibeSyncModal
        isOpen={showVibeSync}
        onClose={() => setShowVibeSync(false)}
        matchName={otherUser.name}
        matchAvatar={otherUser.avatar_url}
        matchId={otherUser.id}
      />

      {/* Vibe Arcade Menu */}
      <VibeArcadeMenu
        isOpen={showArcade}
        onClose={() => setShowArcade(false)}
        onSelectGame={handleGameSelect}
      />

      {/* Game Creators */}
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

      {/* Incoming call overlay */}
      <AnimatePresence>
        {matchCall.incomingCall && (
          <IncomingCallOverlay
            incomingCall={matchCall.incomingCall}
            onAnswer={matchCall.answerCall}
            onDecline={matchCall.declineCall}
          />
        )}
      </AnimatePresence>

      {/* Active call overlay */}
      <AnimatePresence>
        {(matchCall.isInCall || matchCall.isRinging) && !matchCall.incomingCall && (
          <ActiveCallOverlay
            isRinging={matchCall.isRinging}
            isInCall={matchCall.isInCall}
            callType={matchCall.callType}
            isMuted={matchCall.isMuted}
            isVideoOff={matchCall.isVideoOff}
            callDuration={matchCall.callDuration}
            partnerName={otherUser.name}
            partnerAvatar={otherUser.avatar_url}
            localVideoRef={matchCall.localVideoRef}
            remoteVideoRef={matchCall.remoteVideoRef}
            onToggleMute={matchCall.toggleMute}
            onToggleVideo={matchCall.toggleVideo}
            onEndCall={matchCall.endCall}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {photoLightboxInitialId && chatPhotoLightboxItems.length > 0 ? (
          <ChatPhotoLightbox
            key="chat-photo-lightbox"
            items={chatPhotoLightboxItems}
            initialId={photoLightboxInitialId}
            onClose={() => setPhotoLightboxInitialId(null)}
          />
        ) : null}
        {videoLightbox ? (
          <ChatVideoLightbox
            key="chat-video-lightbox"
            videoUrl={videoLightbox.url}
            posterUrl={videoLightbox.posterUrl}
            onClose={() => setVideoLightbox(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default Chat;
