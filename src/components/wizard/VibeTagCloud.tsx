import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface VibeTagCloudProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  maxTags?: number;
}

const allTags = [
  { emoji: "🌙", label: "Night Owl" },
  { emoji: "🌅", label: "Early Bird" },
  { emoji: "🎮", label: "Gamer" },
  { emoji: "📚", label: "Bookworm" },
  { emoji: "🎵", label: "Music Lover" },
  { emoji: "🍕", label: "Foodie" },
  { emoji: "✈️", label: "Wanderlust" },
  { emoji: "🧘", label: "Wellness" },
  { emoji: "💻", label: "Tech Nerd" },
  { emoji: "🎨", label: "Creative" },
  { emoji: "🏃", label: "Fitness" },
  { emoji: "🎬", label: "Film Buff" },
  { emoji: "🌱", label: "Plant Parent" },
  { emoji: "☕", label: "Coffee Addict" },
  { emoji: "🍷", label: "Wine Enthusiast" },
  { emoji: "🐕", label: "Dog Person" },
  { emoji: "🐱", label: "Cat Person" },
  { emoji: "🎭", label: "Introvert" },
  { emoji: "🎉", label: "Extrovert" },
  { emoji: "🧠", label: "Deep Thinker" },
];

const VibeTagCloud = ({ selectedTags, onTagsChange, maxTags = 5 }: VibeTagCloudProps) => {
  const toggleTag = (label: string) => {
    if (selectedTags.includes(label)) {
      onTagsChange(selectedTags.filter((t) => t !== label));
    } else if (selectedTags.length < maxTags) {
      onTagsChange([...selectedTags, label]);
    }
  };

  const isMaxReached = selectedTags.length >= maxTags;

  return (
    <div className="space-y-6">
      {/* Counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium text-foreground">Pick your vibes</span>
        </div>
        <div className={`
          px-3 py-1 rounded-full text-sm font-medium
          ${isMaxReached ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}
        `}>
          {selectedTags.length}/{maxTags} selected
        </div>
      </div>

      {/* Tag Cloud */}
      <motion.div 
        className="flex flex-wrap gap-3 justify-center"
        layout
      >
        {allTags.map((tag, index) => {
          const isSelected = selectedTags.includes(tag.label);
          const isDisabled = !isSelected && isMaxReached;

          return (
            <motion.button
              key={tag.label}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => !isDisabled && toggleTag(tag.label)}
              disabled={isDisabled}
              whileHover={!isDisabled ? { scale: 1.05 } : {}}
              whileTap={!isDisabled ? { scale: 0.95 } : {}}
              className={`
                relative px-4 py-2 rounded-full text-sm font-medium
                transition-all duration-300 select-none
                ${isSelected 
                  ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-[0_0_20px_rgba(168,85,247,0.4)]" 
                  : isDisabled
                    ? "bg-secondary/50 text-muted-foreground/50 cursor-not-allowed"
                    : "bg-secondary text-foreground hover:bg-secondary/80 border border-border hover:border-primary/50"
                }
              `}
            >
              {/* Glow effect for selected */}
              {isSelected && (
                <motion.div
                  layoutId={`glow-${tag.label}`}
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-primary/30 to-accent/30 blur-md -z-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              )}
              
              <span className="flex items-center gap-1.5">
                <span>{tag.emoji}</span>
                <span>{tag.label}</span>
              </span>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Helper text */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center text-xs text-muted-foreground"
      >
        {isMaxReached 
          ? "✨ Perfect! These vibes define you. Tap again to change."
          : `Select ${maxTags - selectedTags.length} more to unlock better matches`
        }
      </motion.p>

      {/* Selected preview */}
      {selectedTags.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-2">Your vibe stack:</p>
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((label) => {
              const tag = allTags.find((t) => t.label === label);
              return (
                <motion.span
                  key={label}
                  layout
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm font-medium"
                >
                  {tag?.emoji} {label}
                </motion.span>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default VibeTagCloud;
