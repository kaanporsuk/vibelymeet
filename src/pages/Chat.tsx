import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Plus,
  Mic,
  Video,
  X,
  CalendarDays,
  Gamepad2,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { VideoDateCard } from "@/components/chat/VideoDateCard";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader } from "@/components/chat/ChatHeader";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { VibeSyncModal } from "@/components/schedule/VibeSyncModal";
import { DateProposalTicket } from "@/components/schedule/DateProposalTicket";
import { DateProposal } from "@/hooks/useSchedule";
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
import { useAuth } from "@/contexts/AuthContext";

type MessageStatusType = "sending" | "sent" | "delivered" | "read";
type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

interface ChatMessage {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  type: "text" | "video-invite" | "voice";
  duration?: number;
  audioBlob?: Blob;
  reaction?: ReactionEmoji;
  status?: MessageStatusType;
}

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  const currentUserId = user?.id || "";
  
  // Fetch real messages and other user data
  const { data: chatData, isLoading: isLoadingChat } = useMessages(id || "", currentUserId);
  const { mutate: sendMessage } = useSendMessage();
  
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showVibeSync, setShowVibeSync] = useState(false);
  const [proposals, setProposals] = useState<DateProposal[]>([]);
  const [showArcade, setShowArcade] = useState(false);
  const [activeGameCreator, setActiveGameCreator] = useState<GameType | null>(null);
  const [gameMessages, setGameMessages] = useState<GameMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Real-time message subscription
  useRealtimeMessages({ matchId: chatData?.matchId || null, enabled: !!chatData?.matchId });

  // Derive chat user info from real data or fallback
  const otherUser = useMemo(() => {
    if (chatData?.otherUser) {
      return {
        id: chatData.otherUser.id,
        name: chatData.otherUser.name || "Unknown",
        age: chatData.otherUser.age || 0,
        avatar_url: chatData.otherUser.avatar_url || "/placeholder.svg",
        vibes: [] as string[],
        isOnline: false,
        lastSeen: undefined as string | undefined,
      };
    }
    return {
      id: id || "unknown",
      name: "Loading...",
      age: 0,
      avatar_url: "/placeholder.svg",
      vibes: [] as string[],
      isOnline: false,
      lastSeen: undefined as string | undefined,
    };
  }, [chatData?.otherUser, id]);

  // Map real messages to chat format
  const messages: ChatMessage[] = useMemo(() => {
    const realMsgs: ChatMessage[] = (chatData?.messages || []).map((m) => ({
      id: m.id,
      text: m.text,
      sender: m.sender,
      time: m.time,
      type: "text" as const,
      status: "read" as MessageStatusType,
    }));
    return [...realMsgs, ...localMessages];
  }, [chatData?.messages, localMessages]);

  // Game creation handlers
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

  // Keywords that trigger date suggestion
  const dateKeywords = ["free", "video", "call", "meet", "date", "tonight", "later", "available"];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Check for date keywords
  useEffect(() => {
    const lowerMessage = newMessage.toLowerCase();
    const hasKeyword = dateKeywords.some((keyword) => lowerMessage.includes(keyword));
    setShowDateSuggestion(hasKeyword && newMessage.length > 3);
  }, [newMessage]);

  // Group messages by sender for proper styling
  const groupedMessages = useMemo(() => {
    return messages.map((message, index) => {
      const prevMessage = messages[index - 1];
      const nextMessage = messages[index + 1];
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
  }, [messages]);

  const handleSend = () => {
    if (!newMessage.trim()) return;
    
    const text = newMessage.trim();
    setNewMessage("");
    setShowDateSuggestion(false);

    if (chatData?.matchId) {
      // Send real message via Supabase
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
            // Remove temp message once real data refreshes
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

  const handleSendVideoInvite = () => {
    if (chatData?.matchId) {
      sendMessage({ matchId: chatData.matchId, content: "📹 Video date invite!" });
    }
    setNewMessage("");
    setShowDateSuggestion(false);
    toast.success("Video date invite sent!");
  };

  const handleVoiceRecordingComplete = (_audioBlob: Blob, _duration: number) => {
    setIsRecording(false);
    toast.info("Voice messages coming soon!");
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
      {/* Subtle background texture */}
      <div className="absolute inset-0 bg-gradient-radial from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <ChatHeader
        user={otherUser}
        isTyping={isTyping}
        matchId={chatData?.matchId || undefined}
        onBack={() => navigate("/matches")}
        onVideoCall={() => toast.info("Video call feature coming soon!")}
        onFocusInput={() => inputRef.current?.focus()}
      />

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative z-10">
        {isLoadingChat ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full text-center py-12"
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-primary flex items-center justify-center mb-4">
              <span className="text-4xl">👋</span>
            </div>
            <h3 className="text-lg font-display font-semibold text-foreground mb-2">
              Start the conversation
            </h3>
            <p className="text-muted-foreground text-sm max-w-xs">
              Say hi to {otherUser.name}! They're excited to meet you.
            </p>
          </motion.div>
        ) : (
          <>
            {groupedMessages.map((message) =>
              message.type === "video-invite" ? (
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

            {/* Date Proposals */}
            {proposals.map((proposal) => (
              <div key={proposal.id} className="flex justify-end">
                <DateProposalTicket
                  proposal={proposal}
                  isOwn={true}
                  matchName={otherUser.name}
                />
              </div>
            ))}

            {/* Game Messages */}
            {gameMessages.map((gameMsg) => (
              <GameBubbleRenderer
                key={gameMsg.id}
                message={gameMsg}
                matchName={otherUser.name}
                onGameUpdate={handleGameUpdate}
              />
            ))}

            {/* Typing indicator */}
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
        {/* Date suggestion chip */}
        <DateSuggestionChip
          visible={showDateSuggestion}
          onSuggest={handleSendVideoInvite}
          onDismiss={() => setShowDateSuggestion(false)}
        />

        {/* Media options */}
        <AnimatePresence>
          {showMediaOptions && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-full left-4 mb-2 glass-card rounded-2xl p-2 border border-border/50"
            >
              <div className="flex gap-2">
                {[
                  { icon: Video, label: "Video", color: "text-neon-pink" },
                  { icon: Mic, label: "Voice", color: "text-neon-violet" },
                ].map(({ icon: Icon, label, color }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setShowMediaOptions(false);
                      toast.info(`${label} feature coming soon!`);
                    }}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-secondary transition-colors"
                  >
                    <div className={cn("w-10 h-10 rounded-full bg-secondary flex items-center justify-center", color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <div className="glass-card border-t border-border/50 p-3 pb-safe">
          <div className="flex items-end gap-2 max-w-lg mx-auto">
            {/* Plus button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowMediaOptions(!showMediaOptions)}
              className={cn(
                "shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                showMediaOptions ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary/80"
              )}
            >
              <motion.div
                animate={{ rotate: showMediaOptions ? 45 : 0 }}
                transition={{ duration: 0.2 }}
              >
                {showMediaOptions ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              </motion.div>
            </motion.button>

            {/* Calendar button for scheduling */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowVibeSync(true)}
              className="shrink-0 w-10 h-10 rounded-full bg-neon-cyan/20 flex items-center justify-center text-neon-cyan hover:bg-neon-cyan/30 transition-colors"
            >
              <CalendarDays className="w-5 h-5" />
            </motion.button>

            {/* Arcade button for games */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowArcade(true)}
              className="shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors"
            >
              <Gamepad2 className="w-5 h-5" />
            </motion.button>

            {/* Text input */}
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                rows={1}
                className="w-full px-4 py-2.5 rounded-2xl glass-card border border-border/50 bg-secondary/30 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all max-h-32"
                style={{
                  height: "auto",
                  minHeight: "44px",
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

      {/* Voice recording overlay */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
          >
            <VoiceRecorder
              onRecordingComplete={handleVoiceRecordingComplete}
              onCancel={() => setIsRecording(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vibe Sync Modal */}
      <VibeSyncModal
        isOpen={showVibeSync}
        onClose={() => setShowVibeSync(false)}
        matchName={otherUser.name}
        matchAvatar={otherUser.avatar_url}
        matchId={otherUser.id}
        onProposalSent={(proposal) => setProposals((prev) => [...prev, proposal])}
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
    </div>
  );
};

export default Chat;
