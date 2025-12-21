import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Plus,
  Mic,
  Video,
  X,
} from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { VideoDateCard } from "@/components/chat/VideoDateCard";
import { DateSuggestionChip } from "@/components/chat/DateSuggestionChip";
import { ChatHeader } from "@/components/chat/ChatHeader";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showDateSuggestion, setShowDateSuggestion] = useState(false);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    </div>
  );
};

export default Chat;
