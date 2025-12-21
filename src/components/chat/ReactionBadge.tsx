import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactionEmoji } from "./EmojiBar";

interface ReactionBadgeProps {
  emoji: ReactionEmoji;
  position: "left" | "right";
  onRemove?: () => void;
}

export const ReactionBadge = ({ emoji, position, onRemove }: ReactionBadgeProps) => {
  const isHot = emoji === "❤️" || emoji === "🔥";
  const isViolet = emoji === "🤣" || emoji === "😮";

  return (
    <motion.button
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 20 }}
      onClick={onRemove}
      className={cn(
        "absolute -bottom-3 px-1.5 py-0.5 rounded-full text-sm",
        "bg-background/90 backdrop-blur-sm border border-border/50",
        "cursor-pointer hover:scale-110 transition-transform",
        position === "right" ? "-left-2" : "-right-2",
        isHot && "shadow-[0_0_12px_rgba(236,72,153,0.6)]",
        isViolet && "shadow-[0_0_12px_rgba(139,92,246,0.6)]"
      )}
      whileTap={{ scale: 0.9 }}
    >
      <span className="leading-none">{emoji}</span>
    </motion.button>
  );
};
