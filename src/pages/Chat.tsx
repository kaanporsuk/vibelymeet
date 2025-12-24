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

type MessageStatusType = "sending" | "sent" | "delivered" | "read";
type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

interface Message {
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

// Mock data for frontend-only implementation
const mockOtherUser = {
  id: "user-1",
  name: "Emma",
  age: 26,
  avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
  vibes: ["Music Lover", "Traveler", "Coffee Addict"],
  isOnline: true,
  lastSeen: "2 hours ago",
};

const mockMessages: Message[] = [
  { id: "1", text: "Hey! I loved your profile 💜", sender: "them", time: "2:30 PM", type: "text" },
  { id: "2", text: "The photo from Portugal was amazing", sender: "them", time: "2:30 PM", type: "text" },
  { id: "3", text: "Thanks! That was such an incredible trip", sender: "me", time: "2:32 PM", type: "text", status: "read" },
  { id: "4", text: "Have you been?", sender: "me", time: "2:32 PM", type: "text", status: "read" },
  { id: "5", text: "Not yet, but it's definitely on my list!", sender: "them", time: "2:35 PM", type: "text" },
  { id: "6", text: "We should totally go sometime 😊", sender: "them", time: "2:35 PM", type: "text" },
  // Mock voice message
  { id: "7", text: "", sender: "them", time: "2:36 PM", type: "voice", duration: 8 },
];

// Mock incoming game messages for testing all 6 games
const generateMockGameMessages = (): GameMessage[] => [
  {
    id: "game-mock-1",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:40 PM",
    gamePayload: {
      gameType: "2truths",
      step: "active",
      data: {
        statements: ["I've been skydiving", "I speak 4 languages", "I met a celebrity"],
        lieIndex: 1,
      },
    },
  },
  {
    id: "game-mock-2",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:42 PM",
    gamePayload: {
      gameType: "would_rather",
      step: "active",
      data: {
        optionA: "Travel to the past",
        optionB: "Travel to the future",
        senderVote: "A" as const,
      },
    },
  },
  {
    id: "game-mock-3",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:44 PM",
    gamePayload: {
      gameType: "charades",
      step: "active",
      data: {
        emojis: ["🚢", "🧊", "❤️", "🎻"],
        answer: "Titanic",
        guesses: [],
      },
    },
  },
  {
    id: "game-mock-4",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:46 PM",
    gamePayload: {
      gameType: "scavenger",
      step: "active",
      data: {
        prompt: "Show me your favorite mug",
        senderPhotoUrl: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400",
        isUnlocked: false,
      },
    },
  },
  {
    id: "game-mock-5",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:48 PM",
    gamePayload: {
      gameType: "roulette",
      step: "active",
      data: {
        question: "What's a dream you've never told anyone?",
        senderAnswer: "I secretly want to write a novel",
        isUnlocked: false,
      },
    },
  },
  {
    id: "game-mock-6",
    senderId: "user-1",
    type: "game_interactive",
    sender: "them",
    time: "2:50 PM",
    gamePayload: {
      gameType: "intuition",
      step: "active",
      data: {
        prediction: "Staying In",
        options: ["Staying In", "Going Out"] as [string, string],
        senderChoice: 0 as const,
      },
    },
  },
];

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showVibeSync, setShowVibeSync] = useState(false);
  const [proposals, setProposals] = useState<DateProposal[]>([]);
  const [showArcade, setShowArcade] = useState(false);
  const [activeGameCreator, setActiveGameCreator] = useState<GameType | null>(null);
  const [gameMessages, setGameMessages] = useState<GameMessage[]>(generateMockGameMessages);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

    const msgId = `msg-${Date.now()}`;
    const newMsg: Message = {
      id: msgId,
      text: newMessage,
      sender: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "text",
      status: "sending",
    };

    setMessages((prev) => [...prev, newMsg]);
    setNewMessage("");
    setShowDateSuggestion(false);

    // Simulate status progression: sending -> sent -> delivered -> read
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === msgId ? { ...msg, status: "sent" as MessageStatusType } : msg))
      );
    }, 300);

    setTimeout(() => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === msgId ? { ...msg, status: "delivered" as MessageStatusType } : msg))
      );
    }, 800);

    setTimeout(() => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === msgId ? { ...msg, status: "read" as MessageStatusType } : msg))
      );
    }, 1500);

    // Simulate typing response
    setTimeout(() => setIsTyping(true), 2000);
    setTimeout(() => {
      setIsTyping(false);
      const responses = [
        "That sounds great! 😊",
        "I'd love that!",
        "You're so sweet 💜",
        "Haha, I know right?",
        "Tell me more!",
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          text: randomResponse,
          sender: "them",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type: "text",
        },
      ]);
    }, 3500);
  };

  const handleSendVideoInvite = () => {
    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      text: "VIDEO_DATE_INVITE",
      sender: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "video-invite",
    };

    setMessages((prev) => [...prev, newMsg]);
    setNewMessage("");
    setShowDateSuggestion(false);
    toast.success("Video date invite sent!");
  };

  const handleVoiceRecordingComplete = (audioBlob: Blob, duration: number) => {
    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      text: "",
      sender: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "voice",
      duration,
      audioBlob,
    };

    setMessages((prev) => [...prev, newMsg]);
    setIsRecording(false);
    toast.success("Voice message sent!");

    // Simulate a voice message response
    setTimeout(() => setIsTyping(true), 1500);
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          text: "Love hearing your voice! 💜",
          sender: "them",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type: "text",
        },
      ]);
    }, 3000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReaction = useCallback((messageId: string, emoji: ReactionEmoji | null) => {
    setMessages((prev) =>
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
        user={mockOtherUser}
        isTyping={isTyping}
        onBack={() => navigate("/matches")}
        onVideoCall={() => toast.info("Video call feature coming soon!")}
        onFocusInput={() => inputRef.current?.focus()}
      />

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative z-10">
        {messages.length === 0 ? (
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
              Say hi to {mockOtherUser.name}! They're excited to meet you.
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
                    senderName={message.sender === "me" ? "You" : mockOtherUser.name}
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
                  avatarUrl={mockOtherUser.avatar_url}
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
                  matchName={mockOtherUser.name}
                />
              </div>
            ))}

            {/* Game Messages */}
            {gameMessages.map((gameMsg) => (
              <GameBubbleRenderer
                key={gameMsg.id}
                message={gameMsg}
                matchName={mockOtherUser.name}
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
        matchName={mockOtherUser.name}
        matchAvatar={mockOtherUser.avatar_url}
        matchId={mockOtherUser.id}
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
        matchName={mockOtherUser.name}
      />
    </div>
  );
};

export default Chat;
