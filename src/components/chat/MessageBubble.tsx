import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import VoiceMessagePlayer from "./VoiceMessagePlayer";
import { EmojiBar, type ReactionEmoji } from "./EmojiBar";
import { ReactionBadge } from "./ReactionBadge";
import { ParticleBurst } from "./ParticleBurst";
import { MessageStatus, type MessageStatusType } from "./MessageStatus";
import { useState, useRef, useCallback } from "react";

interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  type?: "text" | "video-invite" | "voice";
  duration?: number;
  audioBlob?: Blob;
  reaction?: ReactionEmoji;
  status?: MessageStatusType;
}

interface MessageBubbleProps {
  message: Message;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showAvatar: boolean;
  avatarUrl?: string;
  onReaction?: (messageId: string, emoji: ReactionEmoji | null) => void;
}

export const MessageBubble = ({
  message,
  isFirstInGroup,
  isLastInGroup,
  showAvatar,
  avatarUrl,
  onReaction,
}: MessageBubbleProps) => {
  const isMe = message.sender === "me";
  const isVoice = message.type === "voice";
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [showBurst, setShowBurst] = useState<"❤️" | "🔥" | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastTapRef = useRef<number>(0);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, []);

  const handleDoubleTap = useCallback(() => {
    if (!message.reaction) {
      triggerHaptic();
      onReaction?.(message.id, "❤️");
      setShowBurst("❤️");
    }
  }, [message.id, message.reaction, onReaction, triggerHaptic]);

  const handleTouchStart = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      handleDoubleTap();
      lastTapRef.current = 0;
      return;
    }

    lastTapRef.current = now;

    longPressTimerRef.current = setTimeout(() => {
      triggerHaptic();
      setIsFocused(true);
      setShowEmojiBar(true);
    }, 500);
  }, [handleDoubleTap, triggerHaptic]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleSelectReaction = useCallback((emoji: ReactionEmoji) => {
    triggerHaptic();
    onReaction?.(message.id, emoji);
    setShowEmojiBar(false);
    setIsFocused(false);
    
    if (emoji === "❤️" || emoji === "🔥") {
      setShowBurst(emoji);
    }
  }, [message.id, onReaction, triggerHaptic]);

  const handleRemoveReaction = useCallback(() => {
    onReaction?.(message.id, null);
  }, [message.id, onReaction]);

  const handleCloseEmojiBar = useCallback(() => {
    setShowEmojiBar(false);
    setIsFocused(false);
  }, []);

  const bubbleContent = (
    <motion.div
      ref={bubbleRef}
      animate={{ 
        scale: isFocused ? 0.95 : 1,
      }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      className="relative select-none"
    >
      {/* Particle burst effect */}
      <AnimatePresence>
        {showBurst && (
          <ParticleBurst
            emoji={showBurst}
            onComplete={() => setShowBurst(null)}
          />
        )}
      </AnimatePresence>

      {/* Voice message */}
      {isVoice ? (
        <div className="flex flex-col">
          <VoiceMessagePlayer
            duration={message.duration || 0}
            audioBlob={message.audioBlob}
            sender={message.sender}
          />
          {isLastInGroup && (
            <p
              className={cn(
                "text-[10px] mt-1",
                isMe ? "text-right text-muted-foreground" : "text-muted-foreground"
              )}
            >
              {message.time}
            </p>
          )}
        </div>
      ) : (
        /* Text message bubble */
        <div
          className={cn(
            "max-w-[75%] px-4 py-2.5 relative",
            isMe
              ? "bg-gradient-primary text-primary-foreground"
              : "glass-card text-foreground",
            // Rounded corners based on position in group
            isMe
              ? cn(
                  "rounded-2xl",
                  isFirstInGroup && "rounded-tr-2xl",
                  !isFirstInGroup && "rounded-tr-md",
                  isLastInGroup && "rounded-br-md",
                  !isLastInGroup && "rounded-br-2xl"
                )
              : cn(
                  "rounded-2xl",
                  isFirstInGroup && "rounded-tl-2xl",
                  !isFirstInGroup && "rounded-tl-md",
                  isLastInGroup && "rounded-bl-md",
                  !isLastInGroup && "rounded-bl-2xl"
                )
          )}
        >
          <p className="text-sm leading-relaxed">{message.text}</p>
          {isLastInGroup && (
            <div className={cn(
              "flex items-center gap-1 mt-1",
              isMe ? "justify-end" : "justify-start"
            )}>
              <MessageStatus
                status={message.status || "delivered"}
                time={message.time}
                isMyMessage={isMe}
              />
            </div>
          )}

          {/* Reaction badge */}
          <AnimatePresence>
            {message.reaction && (
              <ReactionBadge
                emoji={message.reaction}
                position={isMe ? "right" : "left"}
                onRemove={handleRemoveReaction}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Emoji bar */}
      <AnimatePresence>
        {showEmojiBar && (
          <EmojiBar
            onSelect={handleSelectReaction}
            onClose={handleCloseEmojiBar}
            position={isMe ? "right" : "left"}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );

  return (
    <>
      {/* Background blur overlay when emoji bar is open */}
      <AnimatePresence>
        {isFocused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/50 backdrop-blur-sm z-[99] pointer-events-none"
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={cn(
          "flex items-end gap-2 relative",
          isMe ? "justify-end" : "justify-start",
          isFocused && "z-[100]",
          message.reaction && "mb-4"
        )}
      >
        {/* Avatar placeholder or actual avatar */}
        {!isMe && (
          <div className="w-8 shrink-0">
            {showAvatar ? (
              <img
                src={avatarUrl || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100"}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : null}
          </div>
        )}

        {bubbleContent}

        {/* Spacer for my messages */}
        {isMe && <div className="w-8 shrink-0" />}
      </motion.div>
    </>
  );
};
