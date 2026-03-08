import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useVibeTags } from "@/hooks/useProfiles";
import { Loader2 } from "lucide-react";

interface VibeTagCloudProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  maxTags?: number;
}

interface TagItem {
  emoji: string;
  label: string;
  category: string;
}

const fallbackTags: TagItem[] = [
  { emoji: "😄", label: "Playful", category: "energy" },
  { emoji: "💬", label: "Deep Talker", category: "energy" },
  { emoji: "⚡", label: "Witty", category: "energy" },
  { emoji: "🤗", label: "Warm", category: "energy" },
  { emoji: "🔥", label: "Bold", category: "energy" },
  { emoji: "🌊", label: "Calm", category: "energy" },
  { emoji: "😏", label: "Flirty", category: "energy" },
  { emoji: "🔍", label: "Curious", category: "energy" },
  { emoji: "🎲", label: "Spontaneous", category: "social_style" },
  { emoji: "📅", label: "Planner", category: "social_style" },
  { emoji: "🫂", label: "One-on-One", category: "social_style" },
  { emoji: "🦋", label: "Social Butterfly", category: "social_style" },
  { emoji: "🦉", label: "Night Owl", category: "social_style" },
  { emoji: "🕯️", label: "Slow Burner", category: "social_style" },
  { emoji: "🎙️", label: "Voice-Note Person", category: "social_style" },
  { emoji: "📹", label: "Comfortable on Video", category: "social_style" },
  { emoji: "🎵", label: "Live Music", category: "shared_scenes" },
  { emoji: "🍜", label: "Foodie", category: "shared_scenes" },
  { emoji: "🎨", label: "Artsy", category: "shared_scenes" },
  { emoji: "🌿", label: "Outdoorsy", category: "shared_scenes" },
  { emoji: "💪", label: "Fitness", category: "shared_scenes" },
  { emoji: "📚", label: "Bookworm", category: "shared_scenes" },
  { emoji: "🎬", label: "Film Buff", category: "shared_scenes" },
  { emoji: "✈️", label: "Traveler", category: "shared_scenes" },
];

const categoryConfig: Record<string, { label: string; subtitle: string }> = {
  energy: { label: "Energy", subtitle: "How you feel in interaction" },
  social_style: { label: "Social Style", subtitle: "How you connect" },
  shared_scenes: { label: "Shared Scenes", subtitle: "What you enjoy doing" },
};

const categoryOrder = ["energy", "social_style", "shared_scenes"];

const VibeTagCloud = ({ selectedTags, onTagsChange, maxTags = 5 }: VibeTagCloudProps) => {
  const { data: vibeTags, isLoading } = useVibeTags();

  const allTags: TagItem[] = vibeTags?.length
    ? vibeTags.map((t: any) => ({ label: t.label, emoji: t.emoji, category: t.category || "shared_scenes" }))
    : fallbackTags;

  const toggleTag = (label: string) => {
    if (selectedTags.includes(label)) {
      onTagsChange(selectedTags.filter((t) => t !== label));
    } else if (selectedTags.length < maxTags) {
      onTagsChange([...selectedTags, label]);
    }
  };

  const isMaxReached = selectedTags.length >= maxTags;

  const hasEnergy = selectedTags.some((s) =>
    allTags.some((t) => t.label === s && t.category === "energy")
  );
  const hasSocialStyle = selectedTags.some((s) =>
    allTags.some((t) => t.label === s && t.category === "social_style")
  );

  const grouped = categoryOrder.map((cat) => ({
    key: cat,
    ...categoryConfig[cat],
    tags: allTags.filter((t) => t.category === cat),
  }));

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

      <p className="text-xs text-muted-foreground text-center">
        Pick 5 vibes — at least 1 Energy + 1 Social Style
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="ml-2 text-sm">Loading vibes…</span>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.key} className="space-y-2.5">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{group.label}</h4>
                <p className="text-xs text-muted-foreground">{group.subtitle}</p>
              </div>
              <motion.div className="flex flex-wrap gap-2.5" layout>
                {group.tags.map((tag, index) => {
                  const isSelected = selectedTags.includes(tag.label);
                  const isDisabled = !isSelected && isMaxReached;

                  return (
                    <motion.button
                      key={tag.label}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={() => !isDisabled && toggleTag(tag.label)}
                      disabled={isDisabled}
                      whileHover={!isDisabled ? { scale: 1.05 } : {}}
                      whileTap={!isDisabled ? { scale: 0.95 } : {}}
                      type="button"
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
            </div>
          ))}
        </div>
      )}

      {/* Validation hint */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center text-xs text-muted-foreground"
      >
        {isMaxReached && hasEnergy && hasSocialStyle
          ? "✨ Perfect! These vibes define you. Tap again to change."
          : isMaxReached && (!hasEnergy || !hasSocialStyle)
            ? "⚠️ Pick at least 1 Energy + 1 Social Style vibe"
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
