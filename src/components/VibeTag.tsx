import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface VibeTagProps {
  label: string;
  emoji: string;
  selected: boolean;
  onClick: () => void;
}

export const VibeTag = ({ label, emoji, selected, onClick }: VibeTagProps) => {
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
      <span className="text-3xl">{emoji}</span>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </motion.button>
  );
};
