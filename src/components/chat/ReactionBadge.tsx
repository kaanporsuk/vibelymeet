import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactionEmoji } from "./EmojiBar";

interface ReactionBadgeProps {
  emoji: ReactionEmoji;
  position: "left" | "right";
  onRemove?: () => void;
  /** When true, omit absolute offsets (use inside a flex row). */
  inline?: boolean;
}

export const ReactionBadge = ({ emoji, position, onRemove, inline }: ReactionBadgeProps) => {
  const isHot = emoji === "❤️" || emoji === "🔥";
  const isViolet = emoji === "🤣" || emoji === "😮";

  const className = cn(
    "px-1.5 py-0.5 rounded-full text-sm",
    "bg-background/90 backdrop-blur-sm border border-border/50",
    onRemove && "cursor-pointer hover:scale-110 transition-transform",
    !inline && "absolute -bottom-3",
    !inline && (position === "right" ? "-left-2" : "-right-2"),
    isHot && "shadow-[0_0_12px_rgba(236,72,153,0.6)]",
    isViolet && "shadow-[0_0_12px_rgba(139,92,246,0.6)]",
  );

  const inner = <span className="leading-none">{emoji}</span>;

  if (!onRemove) {
    return (
      <motion.span
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 20 }}
        className={className}
      >
        {inner}
      </motion.span>
    );
  }

  return (
    <motion.button
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 20 }}
      onClick={onRemove}
      className={className}
      whileTap={{ scale: 0.9 }}
    >
      {inner}
    </motion.button>
  );
};
