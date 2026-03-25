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
  Video,
  CalendarDays,
  CalendarPlus,
  Gamepad2,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { VideoDateCard } from "@/components/chat/VideoDateCard";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader } from "@/components/chat/ChatHeader";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import VideoMessageRecorder from "@/components/chat/VideoMessageRecorder";
import { VoiceMessageBubble } from "@/components/chat/VoiceMessageBubble";
import { VideoMessageBubble } from "@/components/chat/VideoMessageBubble";
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
import { useMessages, useSendMessage } from "@/hooks/useMessages";
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
  type: "text" | "video-invite" | "voice" | "video" | "date-suggestion" | "date-suggestion-event";
  duration?: number;
  audioBlob?: Blob;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  videoDuration?: number;
  reaction?: ReactionEmoji;
  status?: MessageStatusType;
  refId?: string | null;
  structuredPayload?: Record<string, unknown> | null;
}

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useUserProfile();
  const currentUserId = user?.id || "";
  const queryClient = useQueryClient();
  
  const { data: chatData, isLoading: isLoadingChat } = useMessages(id || "", currentUserId);
  const { mutate: sendMessage } = useSendMessage();
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
  const [gameMessages, setGameMessages] = useState<GameMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const matchCall = useMatchCall({
    matchId: chatData?.matchId || "",
    onCallEnded: () => {},
  });

  useRealtimeMessages({ matchId: chatData?.matchId || null, enabled: !!chatData?.matchId });

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
        };
      }
      return {
        id: m.id,
        text: m.text,
        sender: m.sender,
        time: m.time,
        type: (m.videoUrl ? "video" : m.audioUrl ? "voice" : "text") as ChatMessage["type"],
        audioUrl: m.audioUrl,
        audioDuration: m.audioDuration,
        videoUrl: m.videoUrl,
        videoDuration: m.videoDuration,
        status: "delivered" as MessageStatusType,
      };
    });
    return [...realMsgs, ...localMessages];
  }, [chatData?.messages, localMessages]);

  const displayMessages = useMemo(() => {
    const lastByRef = new Map<string, string>();
    for (const m of messages) {
      if (m.refId && (m.type === "date-suggestion" || m.type === "date-suggestion-event")) {
        lastByRef.set(m.refId, m.id);
      }
    }
    return messages.filter((m) => {
      if (!m.refId) return true;
      if (m.type !== "date-suggestion" && m.type !== "date-suggestion-event") return true;
      return lastByRef.get(m.refId) === m.id;
    });
  }, [messages]);

  const suggestionById = useMemo(() => {
    const map = new Map<string, DateSuggestionWithRelations>();
    for (const s of dateSuggestions) {
      map.set(s.id, s);
    }
    return map;
  }, [dateSuggestions]);

  const createGameMessage = (payload: GamePayload): GameMessage => ({
    id: `game-${Date.now()}`,
    senderId: "me",
    type: "game_interactive",
    sender: "me",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    gamePayload: payload,
  });

  const handleGameSelect = (gameType: GameType) => {
    setShowArcade(false);
    setActiveGameCreator(gameType);
  };

  const handleGameCreated = (payload: GamePayload) => {
    const newGame = createGameMessage(payload);
    setGameMessages(prev => [...prev, newGame]);
    setActiveGameCreator(null);
    toast.success("Game sent!");
  };

  const handleGameUpdate = (messageId: string, updatedPayload: GamePayload) => {
    setGameMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, gamePayload: updatedPayload } : msg
      )
    );
  };

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

  const handleSend = () => {
    if (!newMessage.trim()) return;
    if (!navigator.onLine) {
      toast.error("You're offline — message will send when you reconnect");
      return;
    }
    
    const text = newMessage.trim();
    setNewMessage("");
    setShowDateSuggestion(false);

    if (chatData?.matchId) {
      const tempId = `temp-${Date.now()}`;
      const tempMsg: ChatMessage = {
        id: tempId,
        text,
        sender: "me",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        type: "text",
        status: "sending",
      };
      setLocalMessages((prev) => [...prev, tempMsg]);

      sendMessage(
        { matchId: chatData.matchId, content: text },
        {
          onSuccess: () => {
            setLocalMessages((prev) => prev.filter((m) => m.id !== tempId));
          },
          onError: () => {
            setLocalMessages((prev) =>
              prev.map((m) => (m.id === tempId ? { ...m, status: "sending" as MessageStatusType } : m))
            );
            toast.error("Failed to send message");
          },
        }
      );
    } else {
      toast.error("No active conversation found");
    }
  };

  const handleOpenDateComposerFromChip = () => {
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
        setComposerCounter(null);
        setComposerDraftId(null);
        setComposerDraftPayload(null);
      }
      setShowDateComposer(true);
    },
    [],
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
      toast.error("Cannot send video message right now");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const videoUrl = await uploadChatVideoToBunny(
        videoBlob,
        session.access_token,
        chatData.matchId
      );

      const { error: msgError } = await supabase.from("messages").insert({
        match_id: chatData.matchId,
        sender_id: user.id,
        content: "📹 Video message",
        video_url: videoUrl,
        video_duration_seconds: Math.round(duration),
      });

      if (msgError) throw msgError;
      toast.success("Video message sent!");
    } catch (err) {
      console.error("Video message error:", err);
      toast.error("Failed to send video message");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReaction = useCallback((messageId: string, emoji: ReactionEmoji | null) => {
    setLocalMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, reaction: emoji || undefined }
          : msg
      )
    );
  }, []);

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
              ) : message.type === "video-invite" ? (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.sender === "me" ? "justify-end" : "justify-start"
                  )}
                >
                  <VideoDateCard
                    senderName={message.sender === "me" ? "You" : otherUser.name}
                    onAccept={() => {
                      toast.success("Video date accepted! 🎉");
                      navigate("/video-date");
                    }}
                    onDecline={() => toast.info("Maybe next time!")}
                  />
                </div>
              ) : message.videoUrl ? (
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
                      <p className={cn("text-[10px] mt-1", message.sender === "me" ? "text-right text-muted-foreground" : "text-muted-foreground")}>{message.time}</p>
                    )}
                  </div>
                </div>
              ) : message.audioUrl ? (
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
                    <VoiceMessageBubble
                      audioUrl={message.audioUrl}
                      duration={message.audioDuration || 0}
                      isMine={message.sender === "me"}
                    />
                    {message.isLastInGroup && (
                      <p className={cn("text-[10px] mt-1", message.sender === "me" ? "text-primary-foreground/60 text-right" : "text-muted-foreground")}>{message.time}</p>
                    )}
                  </div>
                </div>
              ) : (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isFirstInGroup={message.isFirstInGroup}
                  isLastInGroup={message.isLastInGroup}
                  showAvatar={message.showAvatar}
                  avatarUrl={otherUser.avatar_url}
                  onReaction={handleReaction}
                />
              )
            )}

            {gameMessages.map((gameMsg) => (
              <div
                key={gameMsg.id}
                className={cn(
                  "flex mt-2",
                  gameMsg.sender === "me" ? "justify-end" : "justify-start"
                )}
              >
                <div className="max-w-[75%] overflow-hidden">
                  <GameBubbleRenderer
                    message={gameMsg}
                    matchName={otherUser.name}
                    onGameUpdate={handleGameUpdate}
                  />
                </div>
              </div>
            ))}

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

        {/* Input bar */}
        <div className="glass-card border-t border-border/50 p-2 pb-safe">
          <div className="flex items-end gap-1.5 max-w-lg mx-auto">
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsRecordingVideo(true)}
                className="w-9 h-9 rounded-full bg-secondary text-foreground hover:bg-secondary/80 flex items-center justify-center transition-colors"
              >
                <Video className="w-4 h-4" />
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
                whileTap={{ scale: 0.9 }}
                onClick={() => {
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
        onSubmit={(statements, lieIndex) => handleGameCreated({ gameType: "2truths", step: "active", data: { statements, lieIndex } })}
      />
      <WouldRatherCreator
        isOpen={activeGameCreator === "would_rather"}
        onClose={() => setActiveGameCreator(null)}
        onSubmit={(optionA, optionB, vote) => handleGameCreated({ gameType: "would_rather", step: "active", data: { optionA, optionB, senderVote: vote } })}
      />
      <CharadesCreator
        isOpen={activeGameCreator === "charades"}
        onClose={() => setActiveGameCreator(null)}
        onSubmit={(answer, emojis) => handleGameCreated({ gameType: "charades", step: "active", data: { answer, emojis, guesses: [] } })}
      />
      <ScavengerCreator
        isOpen={activeGameCreator === "scavenger"}
        onClose={() => setActiveGameCreator(null)}
        onSubmit={(prompt, photoUrl) => handleGameCreated({ gameType: "scavenger", step: "active", data: { prompt, senderPhotoUrl: photoUrl, isUnlocked: false } })}
      />
      <RouletteCreator
        isOpen={activeGameCreator === "roulette"}
        onClose={() => setActiveGameCreator(null)}
        onSubmit={(question, answer) => handleGameCreated({ gameType: "roulette", step: "active", data: { question, senderAnswer: answer, isUnlocked: false } })}
      />
      <IntuitionCreator
        isOpen={activeGameCreator === "intuition"}
        onClose={() => setActiveGameCreator(null)}
        onSubmit={(options, prediction) => handleGameCreated({ gameType: "intuition", step: "active", data: { prediction: options[prediction], options, senderChoice: prediction } })}
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
