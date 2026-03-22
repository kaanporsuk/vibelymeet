import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import { useVibeTags } from "@/hooks/useProfiles";

interface VibeOption {
  label: string;
  emoji: string;
  category: string;
}

const fallbackVibes: VibeOption[] = [
  // Energy
  { label: "Playful", emoji: "😄", category: "energy" },
  { label: "Deep Talker", emoji: "💬", category: "energy" },
  { label: "Witty", emoji: "⚡", category: "energy" },
  { label: "Warm", emoji: "🤗", category: "energy" },
  { label: "Bold", emoji: "🔥", category: "energy" },
  { label: "Calm", emoji: "🌊", category: "energy" },
  { label: "Flirty", emoji: "😏", category: "energy" },
  { label: "Curious", emoji: "🔍", category: "energy" },
  // Social Style
  { label: "Spontaneous", emoji: "🎲", category: "social_style" },
  { label: "Planner", emoji: "📅", category: "social_style" },
  { label: "One-on-One", emoji: "🫂", category: "social_style" },
  { label: "Social Butterfly", emoji: "🦋", category: "social_style" },
  { label: "Night Owl", emoji: "🦉", category: "social_style" },
  { label: "Slow Burner", emoji: "🕯️", category: "social_style" },
  { label: "Voice-Note Person", emoji: "🎙️", category: "social_style" },
  { label: "Comfortable on Video", emoji: "📹", category: "social_style" },
  // Shared Scenes
  { label: "Live Music", emoji: "🎵", category: "shared_scenes" },
  { label: "Foodie", emoji: "🍜", category: "shared_scenes" },
  { label: "Artsy", emoji: "🎨", category: "shared_scenes" },
  { label: "Outdoorsy", emoji: "🌿", category: "shared_scenes" },
  { label: "Fitness", emoji: "💪", category: "shared_scenes" },
  { label: "Bookworm", emoji: "📚", category: "shared_scenes" },
  { label: "Film Buff", emoji: "🎬", category: "shared_scenes" },
  { label: "Traveler", emoji: "✈️", category: "shared_scenes" },
];

const categoryConfig: Record<string, { label: string; subtitle: string }> = {
  energy: { label: "Energy", subtitle: "How you feel in interaction" },
  social_style: { label: "Social Style", subtitle: "How you connect" },
  shared_scenes: { label: "Shared Scenes", subtitle: "What you enjoy doing" },
};

const categoryOrder = ["energy", "social_style", "shared_scenes"];

interface VibeTagSelectorProps {
  selectedVibes: string[];
  onVibesChange: (vibes: string[]) => void;
  maxSelections?: number;
  /** Profile edit: only Energy + Social Style (omit Shared Scenes). Onboarding: omit for all categories. */
  categoriesOnly?: ("energy" | "social_style" | "shared_scenes")[];
}

export const VibeTagSelector = ({
  selectedVibes,
  onVibesChange,
  maxSelections = 5,
  categoriesOnly,
}: VibeTagSelectorProps) => {
  const { data: vibeTags, isLoading } = useVibeTags();

  const vibeOptions: VibeOption[] = (vibeTags?.length
    ? vibeTags.map((t: any) => ({ label: t.label, emoji: t.emoji, category: t.category || "shared_scenes" }))
    : fallbackVibes
  ).filter(Boolean);

  const order = categoriesOnly?.length
    ? categoryOrder.filter((c) => categoriesOnly.includes(c as "energy" | "social_style" | "shared_scenes"))
    : categoryOrder;

  const toggleVibe = (vibe: string) => {
    if (selectedVibes.includes(vibe)) {
      onVibesChange(selectedVibes.filter((v) => v !== vibe));
    } else if (selectedVibes.length < maxSelections) {
      onVibesChange([...selectedVibes, vibe]);
    }
  };

  const grouped = order.map((cat) => ({
    key: cat,
    ...categoryConfig[cat],
    vibes: vibeOptions.filter((v) => v.category === cat),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Pick 5 vibes — at least 1 Energy + 1 Social Style</p>
        <span
          className={cn(
            "text-sm font-medium",
            selectedVibes.length === maxSelections ? "text-neon-pink" : "text-muted-foreground"
          )}
        >
          {selectedVibes.length}/{maxSelections}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="ml-2 text-sm">Loading vibes…</span>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.key} className="space-y-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{group.label}</h4>
                <p className="text-xs text-muted-foreground">{group.subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.vibes.map((vibe) => {
                  const isSelected = selectedVibes.includes(vibe.label);
                  const isDisabled = !isSelected && selectedVibes.length >= maxSelections;

                  return (
                    <motion.button
                      key={vibe.label}
                      onClick={() => toggleVibe(vibe.label)}
                      disabled={isDisabled}
                      className={cn(
                        "relative flex items-center gap-2 px-4 py-2 rounded-full border-2 transition-all duration-300",
                        isSelected
                          ? "bg-primary/20 border-primary neon-glow-violet"
                          : "glass-card border-transparent hover:border-primary/30",
                        isDisabled && "opacity-40 cursor-not-allowed"
                      )}
                      whileTap={{ scale: 0.97 }}
                      type="button"
                    >
                      <span className="text-lg">{vibe.emoji}</span>
                      <span className="text-sm font-medium">{vibe.label}</span>

                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
                        >
                          <Check className="w-2.5 h-2.5 text-primary-foreground" />
                        </motion.div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
