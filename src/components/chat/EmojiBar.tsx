import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

interface EmojiBarProps {
  onSelect: (emoji: ReactionEmoji) => void;
  onClose: () => void;
  position: "left" | "right";
}

const emojis: { emoji: ReactionEmoji; label: string }[] = [
  { emoji: "❤️", label: "Love" },
  { emoji: "🔥", label: "Hot" },
  { emoji: "🤣", label: "Laugh" },
  { emoji: "😮", label: "Shock" },
  { emoji: "👎", label: "Nope" },
];

export const EmojiBar = ({ onSelect, onClose, position }: EmojiBarProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const getScale = (index: number) => {
    if (hoveredIndex === null) return 1;
    const distance = Math.abs(index - hoveredIndex);
    if (distance === 0) return 1.4;
    if (distance === 1) return 1.15;
    return 1;
  };

  const getTranslateY = (index: number) => {
    if (hoveredIndex === null) return 0;
    const distance = Math.abs(index - hoveredIndex);
    if (distance === 0) return -8;
    if (distance === 1) return -4;
    return 0;
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100]"
        onClick={onClose}
      />

      {/* Emoji bar */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 10 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={cn(
          "absolute bottom-full mb-2 z-[101]",
          position === "right" ? "right-0" : "left-0"
        )}
      >
        <div className="flex items-center gap-1 px-3 py-2 rounded-full bg-background/80 backdrop-blur-xl border border-white/20 shadow-2xl">
          {emojis.map((item, index) => (
            <motion.button
              key={item.emoji}
              animate={{
                scale: getScale(index),
                y: getTranslateY(index),
              }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onTouchStart={() => setHoveredIndex(index)}
              onTouchEnd={() => {
                onSelect(item.emoji);
                setHoveredIndex(null);
              }}
              onClick={() => onSelect(item.emoji)}
              className="w-10 h-10 flex items-center justify-center text-2xl rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              aria-label={item.label}
            >
              {item.emoji}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </>
  );
};
