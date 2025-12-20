import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface VibeTagProps {
  label: string;
  emoji?: string;
  selected?: boolean;
  onClick?: () => void;
  variant?: "button" | "display";
}

const vibeEmojis: Record<string, string> = {
  "Foodie": "🍜",
  "Night Owl": "🦉",
  "Gamer": "🎮",
  "Gym Rat": "💪",
  "Bookworm": "📚",
  "Traveler": "✈️",
  "Music Lover": "🎵",
  "Cinephile": "🎬",
  "Coffee Addict": "☕",
  "Plant Parent": "🌱",
  "Dog Person": "🐕",
  "Cat Person": "🐱",
  "Techie": "💻",
  "Creative": "🎨",
  "Adventurer": "🏔️",
  "Homebody": "🏠",
  "Spiritual": "✨",
  "Fashionista": "👗",
};

export const VibeTag = ({ 
  label, 
  emoji, 
  selected = false, 
  onClick,
  variant = "button" 
}: VibeTagProps) => {
  const displayEmoji = emoji || vibeEmojis[label] || "✨";

  // Display variant - for showing tags (non-interactive)
  if (variant === "display" || !onClick) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full bg-primary/20 text-primary border border-primary/30">
        <span>{displayEmoji}</span>
        <span>{label}</span>
      </span>
    );
  }

  // Button variant - for selection
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-300 border-2",
        selected
          ? "bg-primary/20 border-primary neon-glow-violet"
          : "glass-card border-transparent hover:border-primary/30"
      )}
    >
      <span className="text-3xl">{displayEmoji}</span>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </motion.button>
  );
};
