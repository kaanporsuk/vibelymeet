import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { uploadVoiceToBunny } from "@/services/voiceUploadService";
import { uploadChatVideoToBunny } from "@/services/chatVideoUploadService";
import {
  Send,
  Film,
  CalendarDays,
  CalendarPlus,
  Gamepad2,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader } from "@/components/chat/ChatHeader";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import VideoMessageRecorder from "@/components/chat/VideoMessageRecorder";
import { VoiceMessageBubble } from "@/components/chat/VoiceMessageBubble";
import { VideoMessageBubble } from "@/components/chat/VideoMessageBubble";
import { VibeClipBubble } from "@/components/chat/VibeClipBubble";
import { MessageStatus } from "@/components/chat/MessageStatus";
import { inferChatMediaRenderKind, parseChatImageMessageContent } from "@/lib/chatMessageContent";
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
import { useMessageReactions } from "@/hooks/useMessageReactions";
import { useMessages, useSendMessage, usePublishVibeClip } from "@/hooks/useMessages";
import { setMessageReaction } from "@/lib/messageReactions";
import { reactionPairFromRows, type ReactionPair, type MessageReactionRow } from "../../shared/chat/messageReactionModel";
import { webGamePayloadFromSessionView, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";
import { formatSendGameEventError, newVibeGameSessionId, sendGameEvent } from "@/lib/webGamesApi";
import { dedupeLatestByRefId } from "../../shared/chat/refDedupe";
import { matchHasOpenDateSuggestion } from "../../shared/dateSuggestions/openStatus";
import {
  VIBE_CLIP_TOAST_SEND_FAIL,
  VIBE_CLIP_TOAST_SENT,
  VIBE_CLIP_TOAST_UPLOAD_FAIL,
} from "../../shared/chat/vibeClipCaptureCopy";
import { useUserProfile } from "@/contexts/AuthContext";
import { useMatchCall } from "@/hooks/useMatchCall";
import { IncomingCallOverlay } from "@/components/chat/IncomingCallOverlay";
import { ActiveCallOverlay } from "@/components/chat/ActiveCallOverlay";

type MessageStatusType = "sending" | "sent" | "delivered" | "read";
type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

const DATE_SUGGESTION_KEYWORDS = ["free", "video", "call", "meet", "date", "tonight", "later", "available"];

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
}

type TextMessage = ChatMessage & { type: "text" };

function VibeClipMessageRow({
  message,
  otherUser,
  onReplyWithClip,
  onVoiceReply,
  onSuggestDate,
  onReactionPick,
}: {
  message: ChatMessage & { isFirstInGroup?: boolean; isLastInGroup?: boolean; showAvatar?: boolean };
  otherUser: { avatar_url: string | null } | null;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
  onSuggestDate?: () => void;
  onReactionPick?: (emoji: ReactionEmoji) => void;
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
        message.isFirstInGroup ? "mt-3" : "mt-0.5"
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
            onReplyWithClip={isMine ? undefined : onReplyWithClip}
            onVoiceReply={isMine ? undefined : onVoiceReply}
            onSuggestDate={isMine ? undefined : onSuggestDate}
            onReactionPick={isMine ? undefined : onReactionPick}
            reactionPair={message.reactionPair}
          />
        ) : (
          <VideoMessageBubble
            videoUrl={message.videoUrl}
            duration={message.videoDuration || 0}
            isMine={isMine}
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
  const { data: dateSuggestions = [], refetch: refetchDateSuggestions } = useMatchDateSuggestions(
    chatData?.matchId,
  );

  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [showVibeSync, setShowVibeSync] = useState(false);
  const [showDateComposer, setShowDateComposer] = useState(false);
  const [composerDraftId, setComposerDraftId] = useState<string | null>(null);
  const [composerDraftPayload, setComposerDraftPayload] = useState<Record<string, unknown> | null>(null);
  const [composerCounter, setComposerCounter] = useState<{
    suggestionId: string;
    previousRevision: DateSuggestionWithRelations["revisions"][0];
  } | null>(null);
  const [showArcade, setShowArcade] = useState(false);
  const [activeGameCreator, setActiveGameCreator] = useState<GameType | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const gameStartLockRef = useRef(false);
  const actionLockRef = useRef<Set<string>>(new Set());

  const matchCall = useMatchCall({
    matchId: chatData?.matchId || "",
    onCallEnded: () => {},
  });

  useRealtimeMessages({ matchId: chatData?.matchId || null, enabled: !!chatData?.matchId });
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
        lastSeen: diffMinutes <= 5
          ? undefined
          : diffMinutes <= 60
            ? "Recently active"
            : lastSeenAt
              ? `Active ${Math.round(diffMinutes / 60)}h ago`
              : undefined,
        photoVerified: ou.photo_verified || false,
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
      lastSeen: undefined as string | undefined,
      photoVerified: false,
    };
  }, [chatData?.otherUser, id]);

  const messages: ChatMessage[] = useMemo(() => {
    const realMsgs: ChatMessage[] = (chatData?.messages || []).map((m) => {
      const pair = reactionByMessageId.get(m.id) ?? { mine: null, partner: null };
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
      };
    });
    return [...realMsgs, ...localMessages];
  }, [chatData?.messages, localMessages, reactionByMessageId]);

  const displayMessages = useMemo(() => {
    return dedupeLatestByRefId(messages, {
      isDedupeCandidate: (m) => m.type === "date-suggestion" || m.type === "date-suggestion-event",
      getRefId: (m) => m.refId,
      getId: (m) => m.id,
    });
  }, [messages]);

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
        if (!result.ok) {
          toast.error(formatSendGameEventError(result.error));
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["messages", id, currentUserId] });
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

      if (payload.gameType === "2truths" && typeof updates.guessedIndex === "number") {
        event_type = "two_truths_guess";
        eventPayload = { guess_index: updates.guessedIndex };
      } else if (payload.gameType === "would_rather" && (updates.receiverVote === "A" || updates.receiverVote === "B")) {
        event_type = "would_rather_vote";
        eventPayload = { receiver_vote: updates.receiverVote };
      } else if (payload.gameType === "charades" && Array.isArray(updates.guesses) && updates.guesses.length > 0) {
        const guess = updates.guesses[updates.guesses.length - 1];
        if (typeof guess === "string" && guess.trim()) {
          event_type = "charades_guess";
          eventPayload = { guess };
        }
      } else if (payload.gameType === "scavenger" && typeof updates.receiverPhotoUrl === "string") {
        event_type = "scavenger_photo";
        eventPayload = { receiver_photo_url: updates.receiverPhotoUrl };
      } else if (payload.gameType === "roulette" && typeof updates.receiverAnswer === "string") {
        event_type = "roulette_answer";
        eventPayload = { receiver_answer: updates.receiverAnswer };
      } else if (payload.gameType === "intuition" && (updates.receiverResponse === "correct" || updates.receiverResponse === "wrong")) {
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

        if (!result.ok) {
          toast.error(formatSendGameEventError(result.error));
          return;
        }

        queryClient.invalidateQueries({ queryKey: ["messages", id, currentUserId] });
        queryClient.invalidateQueries({ queryKey: ["matches"] });
      } finally {
        actionLockRef.current.delete(view.gameSessionId);
      }
    },
    [chatData?.matchId, currentUserId, id, queryClient]
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const lowerMessage = newMessage.toLowerCase();
    const hasKeyword = DATE_SUGGESTION_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
    setShowDateSuggestion(hasKeyword && newMessage.length > 3);
  }, [newMessage]);

  const groupedMessages = useMemo(() => {
    return displayMessages.map((message, index) => {
      const prevMessage = displayMessages[index - 1];
      const nextMessage = displayMessages[index + 1];
      const isFirstInGroup = !prevMessage || prevMessage.sender !== message.sender;
      const isLastInGroup = !nextMessage || nextMessage.sender !== message.sender;
      const showAvatar = isLastInGroup && message.sender === "them";

      return {
        ...message,
        isFirstInGroup,
        isLastInGroup,
        showAvatar,
      };
    });
  }, [displayMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [groupedMessages, scrollToBottom]);

  const sendTextMessage = useCallback(
    (opts?: { tempId?: string; text?: string }) => {
      const text = (opts?.text ?? newMessage).trim();
      if (!text) return;
      if (!chatData?.matchId) {
        toast.error("No active conversation found");
        return;
      }
      const tempId = opts?.tempId ?? `temp-${Date.now()}`;
      const optimisticKind = inferChatMediaRenderKind({ content: text });
      const tempMsg: ChatMessage = {
        id: tempId,
        text,
        sender: "me",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        type: optimisticKind === "image" ? "image" : "text",
        status: "sending",
      };
      if (!opts?.tempId) {
        setLocalMessages((prev) => [...prev, tempMsg]);
      } else {
        setLocalMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending", sendError: undefined } : m)));
      }
      sendMessage(
        { matchId: chatData.matchId, content: text },
        {
          onSuccess: () => {
            setLocalMessages((prev) => prev.filter((m) => m.id !== tempId));
          },
          onError: () => {
            setLocalMessages((prev) =>
              prev.map((m) =>
                m.id === tempId
                  ? { ...m, status: "sent" as MessageStatusType, sendError: "Failed to send. Tap retry." }
                  : m
              )
            );
            toast.error("Failed to send message");
          },
        }
      );
    },
    [chatData?.matchId, newMessage, sendMessage]
  );

  const handleSend = () => {
    if (!newMessage.trim()) return;
    if (!navigator.onLine) {
      toast.error("You're offline — message will send when you reconnect");
      return;
    }
    setNewMessage("");
    setShowDateSuggestion(false);
    sendTextMessage();
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
    }) => {
      if (opts.mode === "counter" && opts.counter) {
        setComposerCounter({
          suggestionId: opts.counter.suggestionId,
          previousRevision: opts.counter.previousRevision,
        });
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      } else if (opts.mode === "editDraft" && opts.draftId) {
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
  }, []);

  const onDateSuggestionUpdated = useCallback(() => {
    void refetchDateSuggestions();
    queryClient.invalidateQueries({ queryKey: ["messages", id, currentUserId] });
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

      const { error: msgError } = await supabase.from("messages").insert({
        match_id: chatData.matchId,
        sender_id: user.id,
        content: "🎤 Voice message",
        audio_url: audioUrl,
        audio_duration_seconds: Math.round(duration),
      });

      if (msgError) throw msgError;
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

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const uploaded = await uploadChatVideoToBunny(
        videoBlob,
        session.access_token,
        chatData.matchId
      );

      const clientRequestId = crypto.randomUUID();

      publishVibeClip.mutate(
        {
          matchId: chatData.matchId,
          videoUrl: uploaded.videoUrl,
          durationMs: Math.round(duration * 1000),
          clientRequestId,
          thumbnailUrl: uploaded.thumbnailUrl,
          aspectRatio: uploaded.aspectRatio,
        },
        {
          onSuccess: () => toast.success(VIBE_CLIP_TOAST_SENT),
          onError: (err) => {
            console.error("Vibe Clip publish error:", err);
            toast.error(VIBE_CLIP_TOAST_SEND_FAIL);
          },
        },
      );
    } catch (err) {
      console.error("Vibe Clip upload error:", err);
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

  return (
    <div className="h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-primary/5 via-transparent to-transparent pointer-events-none" />

      <ChatHeader
        user={otherUser}
        isTyping={isTyping}
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

      <main className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 relative z-10">
        {isLoadingChat ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
                if (!chatData?.matchId) return;
                sendMessage({
                  matchId: chatData.matchId,
                  content: "👋",
                });
              }}
              className="px-6 py-2.5 rounded-full bg-gradient-primary text-primary-foreground font-medium text-sm shadow-lg hover:opacity-90 transition-opacity"
            >
              Send a Wave 👋
            </button>
          </motion.div>
        ) : (
          <>
            {groupedMessages.map((message) =>
              message.type === "date-suggestion" || message.type === "date-suggestion-event" ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.sender === "me" ? "justify-end" : "justify-start",
                    message.isFirstInGroup ? "mt-3" : "mt-0.5",
                  )}
                >
                  <div className="max-w-[min(92%,28rem)] w-full">
                    {message.refId && suggestionById.get(message.refId) ? (
                      <DateSuggestionCard
                        suggestion={suggestionById.get(message.refId)!}
                        currentUserId={currentUserId}
                        partnerName={otherUser.name}
                        partnerUserId={chatData?.otherUser?.id ?? id ?? ""}
                        onOpenComposer={handleOpenDateComposer}
                        onUpdated={onDateSuggestionUpdated}
                      />
                    ) : (
                      <div className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Loading date suggestion…
                      </div>
                    )}
                  </div>
                </div>
              ) : message.type === "vibe-game-session" && message.gameSessionView ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.sender === "me" ? "justify-end" : "justify-start",
                    message.isFirstInGroup ? "mt-3" : "mt-0.5",
                  )}
                >
                  <div className="max-w-[75%] overflow-hidden">
                    {(() => {
                      const payload = webGamePayloadFromSessionView(message.gameSessionView);
                      if (!payload) return null;
                      const hydratedGameMessage: GameMessage = {
                        id: message.id,
                        senderId: message.gameSessionView.starterUserId ?? "",
                        type: "game_interactive",
                        sender: message.sender,
                        time: message.time,
                        gamePayload: payload,
                      };
                      return (
                        <GameBubbleRenderer
                          message={hydratedGameMessage}
                          matchName={otherUser.name}
                          onGameUpdate={(_, __, updates) =>
                            submitPersistedGameAction(message.gameSessionView!, payload, updates)
                          }
                        />
                      );
                    })()}
                  </div>
                </div>
              ) : message.type === "vibe_clip" ? (
                <VibeClipMessageRow
                  key={message.id}
                  message={message}
                  otherUser={otherUser}
                  onReplyWithClip={() => setIsRecordingVideo(true)}
                  onVoiceReply={() => scrollToBottom()}
                  onSuggestDate={() => handleOpenDateComposer({ mode: "new" })}
                  onReactionPick={(emoji) => handleReaction(message.id, emoji)}
                />
              ) : message.type === "video" ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-end gap-2",
                    message.sender === "me" ? "justify-end" : "justify-start",
                    message.isFirstInGroup ? "mt-3" : "mt-0.5"
                  )}
                >
                  {message.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {message.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div>
                    <VideoMessageBubble
                      videoUrl={message.videoUrl}
                      duration={message.videoDuration || 0}
                      isMine={message.sender === "me"}
                    />
                    {message.isLastInGroup && (
                      <div className={cn("mt-1 flex", message.sender === "me" ? "justify-end" : "justify-start")}>
                        <MessageStatus
                          status={message.status || "delivered"}
                          time={message.time}
                          isMyMessage={message.sender === "me"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : message.type === "image" ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-end gap-2",
                    message.sender === "me" ? "justify-end" : "justify-start",
                    message.isFirstInGroup ? "mt-3" : "mt-0.5"
                  )}
                >
                  {message.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {message.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div className="max-w-[70%]">
                    <img
                      src={parseChatImageMessageContent(message.text) || ""}
                      alt="Shared image"
                      className="w-56 max-w-full rounded-2xl object-cover border border-border/30 bg-secondary/40"
                      loading="lazy"
                    />
                    {message.isLastInGroup && (
                      <div className={cn("mt-1 flex", message.sender === "me" ? "justify-end" : "justify-start")}>
                        <MessageStatus
                          status={message.status || "delivered"}
                          time={message.time}
                          isMyMessage={message.sender === "me"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : message.type === "voice" ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-end gap-2",
                    message.sender === "me" ? "justify-end" : "justify-start",
                    message.isFirstInGroup ? "mt-3" : "mt-0.5"
                  )}
                >
                  {message.sender !== "me" && (
                    <div className="w-7 shrink-0">
                      {message.showAvatar && (
                        <img src={otherUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[70%] rounded-2xl px-3 py-2.5",
                    message.sender === "me"
                      ? "bg-gradient-primary text-primary-foreground"
                      : "glass-card border border-border/30 text-foreground"
                  )}>
                    {/* Voice timing is rendered only inside VoiceMessageBubble. */}
                    <VoiceMessageBubble
                      audioUrl={message.audioUrl}
                      duration={message.audioDuration || 0}
                      isMine={message.sender === "me"}
                    />
                  </div>
                </div>
              ) : message.type === "text" ? (
                <MessageBubble
                  key={message.id}
                  message={message as TextMessage}
                  isFirstInGroup={message.isFirstInGroup}
                  isLastInGroup={message.isLastInGroup}
                  showAvatar={message.showAvatar}
                  avatarUrl={otherUser.avatar_url}
                  onReaction={handleReaction}
                  onRetryFailedSend={(id) => {
                    const failed = localMessages.find((m) => m.id === id);
                    if (!failed) return;
                    sendTextMessage({ tempId: failed.id, text: failed.text });
                  }}
                />
              ) : null
            )}

            <AnimatePresence>
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <TypingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <div className="relative z-40 shrink-0">
        <DateSuggestionChip
          visible={showDateSuggestion}
          onSuggest={handleOpenDateComposerFromChip}
          onDismiss={() => setShowDateSuggestion(false)}
        />

        <div className="px-2 pb-1">
          <div className="max-w-lg mx-auto flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={handleOpenDateComposerFromChip}
              className="flex-1 min-w-0 h-9 px-3 rounded-full border border-rose-500/35 bg-rose-500/12 text-rose-500 hover:bg-rose-500/20 transition-colors inline-flex items-center justify-center gap-1.5"
              aria-label="Suggest a Date"
            >
              <CalendarPlus className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium truncate">Suggest a Date</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowArcade(true)}
              className="flex-1 min-w-0 h-9 px-3 rounded-full border border-primary/35 bg-primary/12 text-primary hover:bg-primary/20 transition-colors inline-flex items-center justify-center gap-1.5"
              aria-label="Open Games"
            >
              <Gamepad2 className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium truncate">Games</span>
            </motion.button>
          </div>
        </div>

        {/* Input bar */}
        <div className="glass-card border-t border-border/50 p-2 pb-safe">
          <div className="flex items-end gap-1.5 max-w-lg mx-auto">
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsRecordingVideo(true)}
                className="w-9 h-9 rounded-full bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 flex items-center justify-center transition-colors ring-1 ring-violet-500/20"
                title="Vibe Clip — record a short front-camera video (up to 59s)"
              >
                <Film className="w-4 h-4" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowVibeSync(true)}
                className="hidden xs:flex w-9 h-9 rounded-full bg-neon-cyan/20 items-center justify-center text-neon-cyan hover:bg-neon-cyan/30 transition-colors"
                aria-label="Vibely schedule"
              >
                <CalendarDays className="w-4 h-4" />
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
                  setShowDateComposer(true);
                }}
                className="hidden xs:flex w-9 h-9 rounded-full bg-rose-500/15 items-center justify-center text-rose-500 hover:bg-rose-500/25 transition-colors"
                aria-label="Suggest a date"
              >
                <CalendarPlus className="w-4 h-4" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowArcade(true)}
                className="hidden xs:flex w-9 h-9 rounded-full bg-primary/20 items-center justify-center text-primary hover:bg-primary/30 transition-colors"
              >
                <Gamepad2 className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Text input */}
            <div className="flex-1 min-w-0">
              <textarea
                ref={inputRef}
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                rows={1}
                className="w-full text-sm px-3.5 py-2.5 rounded-2xl glass-card border border-border/50 bg-secondary/30 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all max-h-32"
                style={{
                  height: "auto",
                  minHeight: "40px",
                }}
              />
            </div>

            {/* Send / Mic button */}
            {hasText ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSend}
                className="shrink-0 w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-lg"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Send className="w-5 h-5" />
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
            queryClient.invalidateQueries({ queryKey: ["messages", id, currentUserId] });
          }}
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
    </div>
  );
};

export default Chat;
