import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import VoiceMessagePlayer from "./VoiceMessagePlayer";

interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  type?: "text" | "video-invite" | "voice";
  duration?: number;
  audioBlob?: Blob;
}

interface MessageBubbleProps {
  message: Message;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showAvatar: boolean;
  avatarUrl?: string;
}

export const MessageBubble = ({
  message,
  isFirstInGroup,
  isLastInGroup,
  showAvatar,
  avatarUrl,
}: MessageBubbleProps) => {
  const isMe = message.sender === "me";
  const isVoice = message.type === "voice";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn("flex items-end gap-2", isMe ? "justify-end" : "justify-start")}
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
            <p
              className={cn(
                "text-[10px] mt-1",
                isMe ? "text-primary-foreground/70" : "text-muted-foreground"
              )}
            >
              {message.time}
            </p>
          )}
        </div>
      )}

      {/* Spacer for my messages */}
      {isMe && <div className="w-8 shrink-0" />}
    </motion.div>
  );
};
